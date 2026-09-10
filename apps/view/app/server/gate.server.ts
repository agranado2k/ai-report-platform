// decideServe — the ONE viewer gate (architecture-review candidate 2). Every
// serve decision the viewer origin makes — for the public GET /<slug> route
// (purpose: "view") AND the authenticated GET /<slug>/edit route (purpose:
// "edit") — flows through this single function. It absorbs, verbatim in
// behavior, the decision logic the two route loaders previously inlined:
//
//   • slug shape validation (never build a Location/cookie Path out of an
//     unvalidated path segment — both routes' first guard)
//   • the ?v=N ordinal parse (version-query.ts, ADR-0038 §3 — view only; the
//     edit route has always ignored ?v= and that stays true here)
//   • the resolveViewableReport outcome mapping (ADR-0038 §2: deleted→410 /
//     flagged→451 / notfound→404 / scanning→interstitial)
//   • the ADR-0056 ACL gate: resolveAccessDecision + the arp_unlock cookie
//     read/build (view only — the edit route's capability is the edit token,
//     checked INSTEAD of the share-mode ACL, exactly as before)
//   • the ADR-0063 edit auth seam: the arp_edit cookie + resolveEditAccess,
//     incl. the Phase 5-E `oa=` owner-access degrade hand-off
//   • both query-token → Set-Cookie → 303-clean-URL dances (the token never
//     stays in the address bar / history / referer)
//
// The routes consume the returned Decision and ONLY apply it (build headers,
// stream the blob / render the editor data) — no access/serve rule lives in a
// route anymore. Response header assembly stays route-side on purpose: the
// two routes legitimately differ there (e.g. the edit route stamps
// x-robots-tag on its redirects; the public route's redirects never have),
// and the gate must not unify observable behavior the routes didn't share.
//
// The ordering here is load-bearing and pinned by the decision-matrix tests
// (gate.server.test.ts): the ADR-0038 outcome mapping runs BEFORE the ACL
// gate (a deleted private report 410s, it doesn't redirect to unlock), and
// the scanning interstitial is emitted only AFTER access is granted — a
// private report mid-scan must not reveal its existence to visitors who
// couldn't view it once clean (the M7 / PR #170 ordering fix, dogfood
// 2026-07-08 — do not regress).
import {
  type GrantStore,
  type ReportRepository,
  resolveAccessDecision,
  resolveViewableReport,
} from "arp-application";
import {
  type EditClaims,
  makeSlug,
  type Report,
  type ReportVersion,
  readAccessToken,
  readEditToken,
  type Slug,
} from "arp-domain";
import { parseVersionQuery } from "./version-query";

// The unlock cookie (ADR-0056): a per-report capability the viewer issues to itself
// after verifying the app's `?access` hand-off — NOT an app/Clerk credential, so the
// ADR-002/0038 origin isolation holds. Path-scoped + the value is a slug-bound token,
// so it only unlocks its own report.
export const UNLOCK_COOKIE = "arp_unlock";

// The `arp_edit` cookie (ADR-0063) is DELIBERATELY narrower-scoped than the
// unlock cookie: Path=/${slug}/edit (not /${slug}) — an edit capability must
// never ride along on the public GET /<slug> read request, even for the same
// report. HttpOnly + Secure + SameSite=Lax, same posture as the unlock cookie
// (never readable by report-embedded JS, never sent cross-site).
export const EDIT_COOKIE = "arp_edit";

// The `arp_edit_oa` cookie — the OWNER-fallback companion to `arp_edit`
// (2026-08-06 owner-lockout incident). `ownerOpenLocation` mints the `oa=`
// owner access token ONCE, in the query string alongside `et=`; the 303 that
// redeems `et=` into a cookie STRIPS the query, so every degrade that fires on
// the following (cookie-only) request used to have no fallback in hand and
// dumped a private report's OWNER on the public viewer → /unlock → 403. The
// fallback is therefore persisted at the same moment, under the same
// Path=/${slug}/edit scoping and the same Max-Age as the edit cookie — so it
// never outlives the edit session, and it is never sent on the public
// GET /<slug> read.
//
// THIS IS A DELIBERATE, BOUNDED WIDENING OF THE TOKEN'S EXPOSURE — not a
// reduction (an earlier draft of this comment claimed "strictly REDUCES";
// that was false, review #247 H-3). Nothing was removed: `ownerOpenLocation`
// still appends `&oa=` to the query exactly as before, so the address-bar /
// history / referer hop is unchanged. What this adds is (a) an HttpOnly COPY
// of the token in the cookie jar, and (b) five further reachable occasions on
// which the 24h `owner:true` token is emitted into a URL as `?access=`
// (app-origin-unset, lookup-failed, no-servable-version, the route's
// document-load failures, and — defensively, unreachable today —
// gate-decision-unusable), where before only the `denied` branch of the FIRST
// request could do it. Redeeming paths go from one to six. Each of those
// redemptions mints an `arp_unlock` cookie at the BROADER Path=/${slug} with
// Max-Age = claims.exp - now, i.e. up to the token's full 24h — so the
// practical redemption window widens from one request to the whole edit
// session and beyond.
//
// That trade is worth making — the alternative is an owner locked out of
// their own report — and it is bounded by five mitigations:
//   1. VERIFIED, not trusted: `acceptOwnerFallback` requires a valid HMAC,
//      this slug, an unexpired token and `owner === true`, plus a length cap.
//   2. Path=/${slug}/edit — never sent on the public GET /<slug> read.
//   3. Max-Age tied to the EDIT token's remaining life (≤15 min), so the
//      cookie copy dies with the edit session even though the token itself
//      lives 24h.
//   4. HttpOnly + Secure + SameSite=Lax — unreadable by report-embedded JS,
//      never sent cross-site.
//   5. Percent-encoded, so the value can never split the Set-Cookie header.
// Shortening OWNER_TTL_SECONDS is the lever if this window is judged too wide
// (ADR-0056 already notes the 24h is re-minted on every dashboard click).
export const EDIT_OWNER_COOKIE = "arp_edit_oa";

// The owner view's own capability pair (ADR-0089 §4) — `arp_edit`'s exact
// posture, one surface over. Scoped `Path=/${slug}/view`, and the narrowness
// matters MORE here than it does for /edit: `/${slug}` is the request the
// route's sandboxed iframe makes, so a capability at that Path would be
// handed to the untrusted report's own navigation. It is also why the Edit
// action is a plain link rather than a second cookie under `/${slug}/edit` —
// with no capability and no `oa` at that Path, the edit gate FUNNELS through
// the app's one mint, which re-checks `canWrite` live (ADR-0089 §4b).
export const OWNER_VIEW_COOKIE = "arp_view";
export const OWNER_VIEW_OWNER_COOKIE = "arp_view_oa";

/** Parse a named cookie's value out of a raw `Cookie` request header. */
function readCookieValue(cookieHeader: string | null, cookieName: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === cookieName) return rest.join("=") || undefined;
  }
  return undefined;
}

// Max-Age = the token's remaining life (= the grant's TTL for allowlist, ~15 min for
// password), so a long-lived allowlist grant isn't re-prompted every 15 min. Revocation
// stays immediate via the per-request grant check, not via a short cookie (ADR-0056).
function unlockCookie(slug: string, token: string, maxAgeSeconds: number): string {
  // HttpOnly + Secure + SameSite=Lax; path-scoped to this report only.
  return `${UNLOCK_COOKIE}=${token}; Path=/${slug}; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

/**
 * An AUTHENTICATED surface under a report — the URL segment it lives on and
 * the two cookies scoped to it. Named as one thing so a surface cannot
 * half-exist: adding a route without adding its cookie pair (or, worse,
 * borrowing another surface's) is the mistake this record makes unavailable.
 *
 * It sits HERE, above the builders, because both directions go through it: the
 * two `Set-Cookie` builders below take a `Surface` (never a name plus a literal
 * segment), and `readCapability` reads both cookies back off one. A builder
 * that took the pieces separately would let a caller pair one surface's cookie
 * NAME with another's `Path` — the half-existence this record exists to forbid,
 * reintroduced one argument at a time.
 */
interface Surface {
  readonly segment: string;
  readonly capabilityCookie: string;
  readonly ownerCookie: string;
}

const EDIT_SURFACE: Surface = {
  segment: "edit",
  capabilityCookie: EDIT_COOKIE,
  ownerCookie: EDIT_OWNER_COOKIE,
};

const OWNER_VIEW_SURFACE: Surface = {
  segment: "view",
  capabilityCookie: OWNER_VIEW_COOKIE,
  ownerCookie: OWNER_VIEW_OWNER_COOKIE,
};

/**
 * Build a `Set-Cookie` for a capability scoped to ONE authenticated surface
 * under a report — `/<slug>/edit`, `/<slug>/view`. The `surface` segment in
 * the `Path` is the whole security argument and the reason this is a
 * parameter rather than a literal: a capability must reach the surface that
 * needs it and NOTHING else, and in particular must never reach the bare
 * `/<slug>`, which is the public read (and, since ADR-0089, the request the
 * sandboxed iframe makes). Contrast `unlockCookie`, which is deliberately
 * broader because it gates the whole report bundle.
 *
 * `maxAgeSeconds` is always the carried token's remaining life
 * (`claims.exp - nowSeconds`) so a cookie never outlives the capability
 * inside it — there is no independent expiry anywhere in this file.
 *
 * The two `Surface`-taking builders below are what the purposes actually call;
 * this stays private to them so no call site ever names a cookie and a segment
 * separately.
 */
function surfaceCookie(
  name: string,
  slug: string,
  surface: string,
  value: string,
  maxAgeSeconds: number,
): string {
  return `${name}=${value}; Path=/${slug}/${surface}; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

/** A surface's OWN capability cookie — the redeemed Edit token, under that
 *  surface's `Path` (`arp_edit` for /edit, `arp_view` for the owner view). One
 *  builder for both, because the posture is one posture: differing here would
 *  be a security difference nobody decided. */
function capabilityCookie(
  surface: Surface,
  slug: string,
  token: string,
  maxAgeSeconds: number,
): string {
  return surfaceCookie(surface.capabilityCookie, slug, surface.segment, token, maxAgeSeconds);
}

/** A surface's owner-fallback cookie. The percent-encoding lives HERE rather
 *  than at each call site — `readOwnerFallbackCookie` is the one place that
 *  undoes it, and an encode restated per caller is an encode one caller can
 *  forget, at which point a token containing a `;`, `,` or space splits the
 *  `Set-Cookie` header. The value arrives DECODED (`searchParams.get("oa")`
 *  decodes, and so does the cookie read), so this is the only encode. */
function ownerFallbackCookie(
  surface: Surface,
  slug: string,
  oa: string,
  maxAgeSeconds: number,
): string {
  return surfaceCookie(
    surface.ownerCookie,
    slug,
    surface.segment,
    encodeURIComponent(oa),
    maxAgeSeconds,
  );
}

/**
 * HOTFIX carried over from edit-session.ts (Phase 5-E, PR #185), generalised
 * by the 2026-08-06 owner-lockout fix: whenever an OWNER's route into the
 * editor fails — at ANY point, not only at token validation — degrade through
 * the viewer's existing `?access=` owner flow (HttpOnly unlock cookie, URL
 * cleaned by the public route's grant → 303) instead of the bare viewer.
 * Otherwise a private report's owner lands on their own report's unlock wall,
 * which 403s them. Same exposure the pre-Phase-5 owner-view flow already had
 * for this exact token shape (an owner token in `?access=`) — not a new
 * surface. When `oa` is absent (a write-grantee's failed round-trip, or no
 * fallback was minted), behavior is unchanged: the bare public viewer.
 */
function degradeLocation(slug: string, oa: string | undefined): string {
  return oa ? `/${slug}?access=${encodeURIComponent(oa)}` : `/${slug}`;
}

/** Why an /edit request could not render the editor. Every value is a DISTINCT
 *  production failure mode — the incident that motivated this enum was
 *  indistinguishable from four other causes precisely because nothing logged
 *  a reason.
 *
 *  The first five degrade to the viewer (`editDegradeLine`). The three
 *  `document-*` reasons no longer do: they fire AFTER the capability is proven,
 *  so `/edit` renders its own explanatory page and logs `editUnopenableLine`.
 *  They share this enum because they share the `reason` vocabulary — one
 *  taxonomy of "why the editor didn't open" across both outcomes — and because
 *  `DocumentDegradeReason` (edit/load-document.ts) is `Extract`ed from it, so
 *  the two cannot drift. */
export type EditDegradeReason =
  /** No/invalid/expired edit capability (query token or cookie). */
  | "edit-token-denied"
  /** `APP_ORIGIN` unset on the view deployment — env, not report, at fault. */
  | "app-origin-unset"
  /** The report has no clean live version (missing/scanning/flagged/deleted). */
  | "no-servable-version"
  /** The report lookup itself failed (infra). */
  | "lookup-failed"
  /** The live version's entry document could not be read from the blob store. */
  | "document-unreadable"
  /** The entry document could not be split into shell + body (no `<body>`). */
  | "document-unsplittable"
  /** The body HTML defeated the ProseMirror parse (e.g. nesting deep enough to
   *  overflow the recursive DOM walk). Views fine, will not open in the editor. */
  | "document-unparsable"
  /** The route could not use the Decision it was handed — a shape the edit
   *  purpose is not supposed to be able to produce (an `interstitial`, a
   *  `serve` with no edit capability). Unreachable by construction today; it
   *  exists so that if it ever DOES fire it is named rather than silent. */
  | "gate-decision-unusable";

/** The ONE structured log line for an /edit degrade — built here so the gate
 *  and the route (whose own post-gate failures degrade the same way) emit the
 *  identical shape. `owner-edit-degraded-to-view` is kept as the event name
 *  for the owner case: it is the signal ADR-0063 Phase 5-E introduced so "the
 *  secret-misalignment class of incident is visible in logs rather than only
 *  inferable from user reports", and it is what incident queries look for. */
export function editDegradeLine(
  slug: string,
  ownerFallback: boolean,
  reason: EditDegradeReason,
): string {
  return JSON.stringify({
    event: ownerFallback ? "owner-edit-degraded-to-view" : "edit-degraded-to-view",
    slug,
    reason,
  });
}

/** The line for a document failure, which no longer degrades to the view at
 *  all — `/edit` renders its own explanatory page instead (`edit/unopenable.ts`).
 *  A DISTINCT event on purpose: `*-degraded-to-view` naming an outcome that
 *  never reaches the view is exactly the kind of drift this fix exists to
 *  remove, and the two are operationally different — a degrade is the incident
 *  class (an owner silently stranded, possibly at the unlock wall), while this
 *  is a handled outcome the user was actually told about. `reason` keeps the
 *  same three values, so ADR-0063's open question (WHICH of the three fires in
 *  production) is still answerable off this line.
 *
 *  `ownerFallback` records whether the page could hand the visitor a WORKING
 *  read-only link (`degradeTargetFor(...).ownerFallback`). Without it the line
 *  cannot distinguish the two outcomes that matter operationally: an owner told
 *  why, who can still read their report, versus the shape measured in
 *  production on f83ed59 — a bare `/{slug}` that walks a private report's owner
 *  back to the unlock page and round again. The whole lesson of #247 is that a
 *  fallback dying at one hop stays invisible unless that hop says so. The TOKEN
 *  is never logged; only the boolean. */
export function editUnopenableLine(
  slug: string,
  reason: EditDegradeReason,
  ownerFallback: boolean,
): string {
  return JSON.stringify({ event: "edit-document-unopenable", slug, reason, ownerFallback });
}

/**
 * Where a route should send a visitor it cannot render for, and whether that
 * target carries an owner fallback (which selects the log event).
 *
 * ONE answer for every EditDecision shape. The union no longer contains the
 * arms purpose "edit" cannot produce — that is what the ViewDecision/
 * EditDecision split bought — so the only shapes left here are ones the gate
 * really does emit, and the serve arm's fields are no longer optional. The
 * /edit loader used to have two answers: `decision.degradeTo` for its
 * document-load failures, and a hard-coded `/${params.slug}` — silently, with
 * no log line — in its defensive-narrowing branch (review #247 M-2). That is
 * the same "left one branch untouched" shape ADR-0063 criticises Phase 5-E for,
 * and it is how an owner ends up at the unlock wall.
 */
export function degradeTargetFor(
  decision: EditDecision,
  slug: string,
): { readonly to: string; readonly ownerFallback: boolean } {
  return decision.kind === "serve"
    ? { to: decision.degradeTo, ownerFallback: decision.ownerFallback }
    : { to: `/${slug}`, ownerFallback: false };
}

export type Purpose = "view" | "edit" | "ownerView";

export interface GateDeps {
  readonly reports: ReportRepository;
  /** Allowlist revocation-C — the per-request live-grant check (ADR-0056). */
  readonly grants: GrantStore;
  /** `viewerAccessConfig().secret` — undefined in previews/dev without the env wired.
   *  Both token paths fail closed on an unset secret (an HMAC accepts an empty key,
   *  so an unset secret would otherwise admit a forged `payload.HMAC("",payload)`). */
  readonly secret: string | undefined;
  /** `viewerAccessConfig().appOrigin` — where an un-authorized private request is sent
   *  (view), and the editor's Save/API target (edit). Fail-closed when unset. */
  readonly appOrigin: string | undefined;
  readonly nowSeconds: number;
  /** Structured-log sink for the owner-degrade observability signal (claude-review
   *  #187). Defaults to `console.warn` — Vercel captures it to the function logs;
   *  the view origin has no logger of its own (ADR-0038 keeps it minimal). */
  readonly warn?: (line: string) => void;
}

/** The arms that mean the same thing under either purpose. Shared so the two
 *  purpose-specific unions below differ ONLY where they genuinely differ — the
 *  "serve" arm — rather than restating four identical shapes twice. */
type TerminalArms =
  /** A terminal HTTP error (404 / 410 / 451 / 500 / 503) with its body text. */
  | { readonly kind: "error"; readonly status: number; readonly message: string }
  /** 302: the app unlock hand-off (view) or the degrade-to-public-viewer (edit). */
  | { readonly kind: "redirect"; readonly to: string }
  /** 303: a valid query-token hand-off → set the capability cookie(s) and bounce
   *  to the clean URL, dropping the token out of the address bar/history/referer.
   *  A LIST because the edit hand-off persists two capabilities in one response:
   *  the edit cookie and — for an owner — the `oa` fallback that would otherwise
   *  die with the stripped query. The route must APPEND each, never `set`. */
  | {
      readonly kind: "setCookieAndRedirect";
      readonly cookies: readonly string[];
      readonly to: string;
    };

/** What `purpose: "view"` can decide. No `edit` capability and no degrade
 *  target: the public route has nothing to degrade TO — it IS the degrade
 *  target. */
export type ViewDecision =
  /** Access granted and there is a clean version: stream it. */
  | { readonly kind: "serve"; readonly report: Report; readonly version: ReportVersion }
  /** Access granted but the report is mid-scan → the ADR-0038 §2 holding page. */
  | { readonly kind: "interstitial" }
  | TerminalArms;

/** What `purpose: "edit"` can decide. Note what is NOT here: `interstitial`.
 *  The edit chain degrades a mid-scan report to the viewer (`no-servable-
 *  version`) rather than holding on it, so that arm is unreachable — and now
 *  unrepresentable.
 *
 *  Note also what is no longer optional. Before this split the three edit-only
 *  fields were `?` because ONE union had to describe both purposes, so the
 *  /edit loader carried a branch whose own comment read "the types can't prove
 *  it" and an `EditDegradeReason` (`gate-decision-unusable`) naming a state the
 *  gate cannot produce. The prose was right; it just wasn't checkable. */
export type EditDecision =
  /** Access granted, the capability is validated, and there is a clean version
   *  to load the editor data for. */
  | {
      readonly kind: "serve";
      readonly report: Report;
      readonly version: ReportVersion;
      /** The validated edit capability. ALWAYS present — decideEdit reaches
       *  this arm only past a verified token/cookie. */
      readonly edit: { readonly token: string; readonly claims: EditClaims };
      /** Where the route must send the visitor if IT cannot render after all.
       *  Carries the owner `?access=` fallback when one is in play, so a
       *  route-side failure can't strand an owner at the unlock wall the way
       *  the gate's own degrades no longer can.
       *
       *  As of 2026-08-06 the route's DOCUMENT failures (the blob read, the
       *  shell split, the ProseMirror parse) no longer REDIRECT here: they
       *  render an explanatory page instead (`edit/unopenable.ts`), which is
       *  why the unlock wall is unreachable from them by construction rather
       *  than by carrying the right token. They still consume this value — as
       *  the `href` of that page's "Open the read-only view" link, so the one
       *  forward action it offers actually reaches the report for a private
       *  report's owner. A `Location` the browser follows and an `href` the
       *  user clicks want the identical destination; giving them two answers is
       *  how the first one silently rotted. */
      readonly degradeTo: string;
      /** Whether `degradeTo` carries an owner fallback — selects the log event. */
      readonly ownerFallback: boolean;
    }
  | TerminalArms;

/** How much the owner view's holder may do (ADR-0089 §3). Not a role — it is
 *  what THIS request proved, and it selects whether the chrome offers Edit. */
export type OwnerViewCapability =
  /** A validated Edit token: the app ran `canWrite` at mint time. Full chrome. */
  | "write"
  /** No capability, but a VERIFIED `owner:true` fallback. Read-only chrome, no
   *  Edit action. This is ADR-0063's `oa=` degrade, improved: an owner whose
   *  edit round-trip never happened used to land on the bare `/<slug>` with no
   *  chrome at all. Same token, same check, same access — now with a title bar. */
  | "ownerRead";

/** What `purpose: "ownerView"` can decide (ADR-0089). Shaped like
 *  `EditDecision` — same capability, same degrade vocabulary — and differing
 *  in exactly one place: it carries `capability` instead of the edit token,
 *  because this route has no cross-origin data plane and therefore
 *  deliberately puts NO token in its loader payload (ADR-0089 §6).
 *
 *  Like `EditDecision` it has no `interstitial` arm: a mid-scan report
 *  degrades to the public viewer, which owns that state machine. */
export type OwnerViewDecision =
  | {
      readonly kind: "serve";
      readonly report: Report;
      readonly version: ReportVersion;
      readonly capability: OwnerViewCapability;
      /** `Set-Cookie` values the served chrome must APPEND (never `set`).
       *
       *  Exactly one cookie ever appears here and it is always `arp_unlock` at
       *  `Path=/<slug>`, redeemed from a VERIFIED `oa`: the framed navigation
       *  to `/<slug>` carries that cookie and nothing else, so without it the
       *  chrome renders around an unlock WALL for every non-public report
       *  (ADR-0089 §4c). A capability cookie must NEVER reach this list —
       *  `Path=/<slug>` is the untrusted report's own request (§4a). Empty
       *  when no `oa` is in hand, which is the write-grantee case §8 records. */
      readonly cookies: readonly string[];
      /** Where the route must send a visitor it cannot render for, carrying
       *  the owner `?access=` fallback when one is in play. */
      readonly degradeTo: string;
      /** Whether `degradeTo` carries an owner fallback — selects the log event. */
      readonly ownerFallback: boolean;
    }
  | TerminalArms;

/** Any purpose's answer. Kept for the few places that are purpose-agnostic;
 *  prefer the specific one — that is the whole point of the split. */
export type Decision = ViewDecision | EditDecision | OwnerViewDecision;

/** The one viewer gate: decide what the origin should do for `rawSlug` under
 *  `purpose`, given the request's query/cookie capabilities. Pure over `deps`
 *  (all I/O behind the injected ports); never throws. */
export async function decideServe(
  request: Request,
  rawSlug: string,
  purpose: "view",
  deps: GateDeps,
): Promise<ViewDecision>;
export async function decideServe(
  request: Request,
  rawSlug: string,
  purpose: "edit",
  deps: GateDeps,
): Promise<EditDecision>;
export async function decideServe(
  request: Request,
  rawSlug: string,
  purpose: "ownerView",
  deps: GateDeps,
): Promise<OwnerViewDecision>;
export async function decideServe(
  request: Request,
  rawSlug: string,
  purpose: Purpose,
  deps: GateDeps,
): Promise<Decision> {
  // Unknown/invalid slug is indistinguishable from blocked content → 404.
  const slug = makeSlug(rawSlug);
  if (!slug.ok) return { kind: "error", status: 404, message: "Not found" };
  const url = new URL(request.url);

  switch (purpose) {
    case "edit":
      return decideEdit(request, url, slug.value, deps);
    case "ownerView":
      return decideOwnerView(request, url, slug.value, deps);
    default:
      return decideView(request, url, slug.value, deps);
  }
}

// --- purpose: "view" — the public route's decision chain (ADR-0038 + 0056) ---
async function decideView(
  request: Request,
  url: URL,
  slug: Slug,
  deps: GateDeps,
): Promise<ViewDecision> {
  // ?v=N (issue #155, ADR-0038 §3): resolve a specific ReportVersion by ordinal
  // instead of the live version. Absent/malformed `v` parses to `undefined`
  // (parseVersionQuery), which resolveViewableReport treats identically to no
  // `v=` at all — the live-serving default is unchanged. The requested version
  // passes through the EXACT SAME scan-status state machine as the live path.
  const requestedVersionNo = parseVersionQuery(url.searchParams.get("v"));

  const outcome = await resolveViewableReport(slug, deps.reports, requestedVersionNo);
  if (!outcome.ok) return { kind: "error", status: 500, message: "Lookup failed" };
  switch (outcome.value.kind) {
    case "deleted":
      return { kind: "error", status: 410, message: "No longer available" };
    case "flagged":
      return { kind: "error", status: 451, message: "Unavailable — flagged for review" };
    case "notfound":
      return { kind: "error", status: 404, message: "Not found" };
  }

  // Servable (clean live / clean ?v=N ordinal) OR still scanning → enforce the
  // Acl (ADR-0056) BEFORE emitting anything about the report. The holding page
  // sits behind the same gate as content (dogfood 2026-07-08): a private report
  // mid-scan must show a visitor exactly what it will show them once clean —
  // the unlock redirect — not a 200 that reveals the slug exists and is being
  // scanned. Same `report.acl`, same resolveAccessDecision call regardless of
  // which version was resolved above — ?v=N is not a separate gate, it's the
  // identical gate applied to a different version (ADR-0038 §3).
  const { report } = outcome.value;

  // The app authorizes private reports; the viewer only verifies a slug-bound token
  // (from the `?access` hand-off or a prior unlock cookie). Public reports serve
  // directly. Async + grant-aware: for `allowlist`, a valid token is only honored
  // while its `report_grants` row is live (revocation-C) — the per-request check.
  const decided = await resolveAccessDecision(
    report.acl,
    report.id,
    {
      cookie: readCookieValue(request.headers.get("cookie"), UNLOCK_COOKIE),
      query: url.searchParams.get("access") ?? undefined,
    },
    slug,
    deps.secret ?? "",
    deps.nowSeconds,
    deps.grants,
  );
  if (!decided.ok) return { kind: "error", status: 500, message: "Access check failed" };
  const decision = decided.value;
  if (decision.kind === "unlock") {
    // Send the viewer to the app to authorize. Fail closed if the app origin is unset.
    if (!deps.appOrigin) {
      return {
        kind: "error",
        status: 503,
        message: "Private report — viewing is not available here",
      };
    }
    return { kind: "redirect", to: `${deps.appOrigin}/unlock/${slug}` };
  }
  if (decision.kind === "grant") {
    // Valid hand-off → set the unlock cookie (lasting as long as the token/grant)
    // and redirect to the clean URL (drops the token from the address bar/history).
    return {
      kind: "setCookieAndRedirect",
      cookies: [unlockCookie(slug, decision.token, decision.maxAgeSeconds)],
      to: `/${slug}`,
    };
  }
  // Access granted. Mid-scan there is still no clean version to serve — the
  // authorized visitor (owner via /open, or anyone the mode admits, e.g. public)
  // gets the ADR-0038 §2 holding page, exactly as before.
  if (outcome.value.kind === "scanning") return { kind: "interstitial" };
  return { kind: "serve", report, version: outcome.value.version };
}

// --- purpose: "edit" — the edit route's auth seam (ADR-0063 Decisions 3-4) ---
//
// The edit capability is checked INSTEAD of the report's share-mode ACL: a
// valid edit token proves the app already ran its `canWrite` check at mint
// time (and re-runs it live on every save/API call — ADR-0063 §3/§5), so the
// gate here never consults `report.acl` — exactly the pre-extraction route's
// behavior. A MISSING/INVALID capability funnels to the app's edit-token mint
// (`deniedEdit` → /reports/{slug}/open — the grantee-discoverability fix);
// every post-capability "can't render" case still degrades to the public
// viewer, which owns the ADR-0038 §2 state machine — this purpose never emits
// `interstitial` or (beyond the slug guard) `error`.
async function decideEdit(
  request: Request,
  url: URL,
  slug: Slug,
  deps: GateDeps,
): Promise<EditDecision> {
  // The `?et=` / arp_edit-cookie / verified-`oa` seam, shared with the
  // ownerView purpose (readCapability). The `oa` fallback `ownerOpenLocation`
  // mints alongside `et=` for actual owners arrives ONCE, on the query — and
  // the 303 below strips the query — so it is read from the query OR from the
  // cookie the 303 persisted it into. Without that, every degrade on the
  // post-303 request was blind to the fact that it was stranding an OWNER
  // (the 2026-08-06 lockout).
  const cap = readCapability(url, request.headers.get("cookie"), slug, EDIT_SURFACE, deps);
  const { oa } = cap;

  if (cap.kind === "refused") return deniedEdit(slug, oa, cap.cause, deps);
  if (cap.kind === "handoff") {
    return {
      kind: "setCookieAndRedirect",
      // Mint the arp_edit cookie — plus the owner fallback, so it SURVIVES the
      // clean-URL bounce — and 303. Drops both tokens out of the address
      // bar/history/referer, exactly like the view path's grant.
      cookies: [
        capabilityCookie(EDIT_SURFACE, slug, cap.token, cap.maxAge),
        ...(oa ? [ownerFallbackCookie(EDIT_SURFACE, slug, oa, cap.maxAge)] : []),
      ],
      to: `/${slug}/edit`,
    };
  }

  // A valid, already-redeemed arp_edit cookie. Never render the editor without
  // a configured app origin — editViewHeaders REQUIRES it for connect-src, and
  // there would be nowhere for Save to POST to anyway (fail closed).
  if (!deps.appOrigin) return degradedEdit(slug, oa, "app-origin-unset", deps);

  // Any non-"serve" outcome (not found / deleted / flagged / still scanning)
  // or a lookup failure degrades to the public viewer, which already renders
  // the correct status page for every one of those states (ADR-0038 §2) —
  // the edit purpose doesn't duplicate that state machine, it only adds
  // "render the editor" on top of the one state with a document to edit.
  // Deliberately NO ?v= here — the editor always opens the live version.
  const outcome = await resolveViewableReport(slug, deps.reports);
  if (!outcome.ok) return degradedEdit(slug, oa, "lookup-failed", deps);
  if (outcome.value.kind !== "serve") return degradedEdit(slug, oa, "no-servable-version", deps);
  return {
    kind: "serve",
    report: outcome.value.report,
    version: outcome.value.version,
    edit: { token: cap.token, claims: cap.claims },
    degradeTo: degradeLocation(slug, oa),
    ownerFallback: oa !== undefined,
  };
}

// --- purpose: "ownerView" — the owner view's decision chain (ADR-0089) ---
//
// The owner view frames the CANONICAL /<slug> under first-party chrome. Its
// capability is the SAME Edit token /edit uses — a valid one proves the app
// ran `canWrite` at mint time — so like /edit this purpose never consults
// `report.acl`: a report anyone could read at /<slug> still needs a capability
// to get CHROME around it.
//
// It differs from decideEdit in exactly two places, and both are ADR-0089
// decisions rather than conveniences:
//
//   1. The 303 sets THREE cookies, not two. `arp_view` + `arp_view_oa` under
//      Path=/<slug>/view, and — from the VERIFIED `oa` — `arp_unlock` under
//      Path=/<slug>, because that is the cookie the sandboxed iframe's own
//      navigation to /<slug> carries. Without it a private report's frame
//      would bounce to the unlock wall INSIDE the iframe. Nothing is minted
//      here (the view origin never mints, ADR-0056's keystone): this is the
//      same redemption `decideView`'s `grant` branch already performs on the
//      same token, one hop earlier and without the address-bar round-trip.
//      The SERVE arm re-issues that same unlock cookie whenever a verified
//      `oa` is in hand, because `ownerRead` is reached with no hand-off
//      behind it — see the `cookies` field on the serve arm.
//
//   2. An ABSENT capability backed by a verified `oa` SERVES, read-only,
//      instead of redirecting to the bare viewer. The rejection-vs-absence
//      routing itself (ADR-0063 Phase 5-G) is inherited unchanged — and
//      inherited by CALLING `funnelTarget`, which is the ONE implementation
//      of that rule and carries its full rationale. Only what this purpose
//      does with a NON-funnelled denial differs from /edit.
async function decideOwnerView(
  request: Request,
  url: URL,
  slug: Slug,
  deps: GateDeps,
): Promise<OwnerViewDecision> {
  const cap = readCapability(url, request.headers.get("cookie"), slug, OWNER_VIEW_SURFACE, deps);
  const { oa } = cap;

  if (cap.kind === "handoff") {
    return {
      kind: "setCookieAndRedirect",
      cookies: [
        capabilityCookie(OWNER_VIEW_SURFACE, slug, cap.token, cap.maxAge),
        ...(oa
          ? [
              ownerFallbackCookie(OWNER_VIEW_SURFACE, slug, oa, cap.maxAge),
              // Max-Age is the `oa` token's OWN remaining life, not the edit
              // token's. Capping it at the edit capability's ~15 min would
              // start bouncing the FRAME to the unlock wall mid-session — the
              // one place the user cannot see a URL to explain it.
              unlockCookie(slug, oa, ownerAccessMaxAge(oa, slug, deps)),
            ]
          : []),
      ],
      to: `/${slug}/view`,
    };
  }

  let capability: OwnerViewCapability = "write";
  if (cap.kind === "refused") {
    // The SAME funnel `deniedEdit` applies, inherited by CALL rather than by
    // copy (ADR-0089 §3: "deliberately inherited rather than re-decided") —
    // `funnelTarget` owns the rejection-vs-absence ordering and the both-deps
    // guard, and owning it in one place is what stops the two purposes forking
    // it. Answered BEFORE the report is looked up, so a nonexistent report
    // answers identically: no existence leak.
    const funnel = funnelTarget(slug, oa, cap.cause, deps);
    if (funnel) return { kind: "redirect", to: funnel };
    // No funnel and no fallback: the bare public viewer, warned. With a
    // verified `oa` this is instead ADR-0089 §3's `ownerRead` row — the same
    // token and check as the `?access=` degrade it replaces, now under chrome.
    if (!oa) return degradedEdit(slug, undefined, "edit-token-denied", deps);
    capability = "ownerRead";
  }

  // Never render the chrome without a configured app origin — its header
  // profile (editViewHeaders) requires one for connect-src (fail closed).
  if (!deps.appOrigin) return degradedEdit(slug, oa, "app-origin-unset", deps);

  // Any non-"serve" outcome or a lookup failure degrades to the public viewer,
  // which owns the ADR-0038 §2 state machine. Deliberately no ?v=: the owner
  // view frames the live version, exactly as the editor opens it.
  const outcome = await resolveViewableReport(slug, deps.reports);
  if (!outcome.ok) return degradedEdit(slug, oa, "lookup-failed", deps);
  if (outcome.value.kind !== "serve") return degradedEdit(slug, oa, "no-servable-version", deps);
  return {
    kind: "serve",
    report: outcome.value.report,
    version: outcome.value.version,
    capability,
    // The frame's read capability, re-issued on EVERY serve that holds a
    // verified `oa` rather than only on the 303. On the `write` arm that is a
    // refresh (the hand-off set it already); on `ownerRead` it is the whole
    // point — that arm is reached with no hand-off behind it, so nothing else
    // would ever put `arp_unlock` on the browser and §3's "same token, same
    // check, same access" would be false for every non-public report.
    // Deliberately one rule over both arms: an arm-specific cookie is what
    // rots when the matrix grows a fourth row.
    cookies: oa ? [unlockCookie(slug, oa, ownerAccessMaxAge(oa, slug, deps))] : [],
    degradeTo: degradeLocation(slug, oa),
    ownerFallback: oa !== undefined,
  };
}

/** The `oa` token's own remaining life, for the unlock cookie the framed
 *  `/<slug>` navigation needs. The token reaching here has already been
 *  verified by `acceptOwnerFallback`, so the re-read cannot fail — but it is
 *  written to fail CLOSED (`0`, which expires the cookie immediately) rather
 *  than assert, because that is the safe direction for a capability. */
function ownerAccessMaxAge(oa: string, slug: Slug, deps: GateDeps): number {
  const claims = deps.secret ? readAccessToken(oa, slug, deps.secret, deps.nowSeconds) : null;
  return claims ? Math.max(0, claims.exp - deps.nowSeconds) : 0;
}

/** A generous ceiling on an accepted `oa=`. A real owner Access token is a
 *  couple of hundred bytes; anything past this is someone trying to park bulk
 *  in the cookie jar (the value is echoed into `Set-Cookie` verbatim). Checked
 *  BEFORE the HMAC so an oversized string is never even hashed. */
const MAX_OWNER_FALLBACK_LENGTH = 1024;

/**
 * VERIFY the owner fallback before it counts as one (review #247 H-1).
 *
 * `oa` used to be taken straight off the query/cookie: written verbatim into a
 * `Set-Cookie`, and used as `ownerFallback: oa !== undefined` — the flag that
 * selects the `owner-edit-degraded-to-view` event. So anyone holding a valid
 * `et=` (notably a write-grantee, for whom `ownerOpenLocation` deliberately
 * never mints an `oa`, open-report.server.ts) could append `&oa=anything` and
 * forge the exact incident signal this seam exists to produce — and plant
 * unbounded bytes in the cookie jar while they were at it.
 *
 * There was never a privilege escalation: redemption is verified downstream by
 * `resolveAccessDecision` (`claims.owner === true` off a signature-checked,
 * slug-bound, unexpired token), so a forged `oa` only ever bought a redirect to
 * a `?access=` the viewer then rejects. But the whole value of this change is
 * OBSERVABILITY, and a forgeable signal is worse than no signal.
 *
 * So the gate now applies the same check the redeemer applies, up front: honor
 * `oa` only when it parses as an owner Access token for THIS slug. Fails closed
 * on an unset secret, exactly like both token paths above.
 */
function acceptOwnerFallback(
  raw: string | undefined,
  slug: Slug,
  deps: GateDeps,
): string | undefined {
  if (!raw || raw.length > MAX_OWNER_FALLBACK_LENGTH || !deps.secret) return undefined;
  const claims = readAccessToken(raw, slug, deps.secret, deps.nowSeconds);
  return claims?.owner === true ? raw : undefined;
}

/** Read the owner fallback back out of its cookie, undoing the percent-encoding
 *  `ownerFallbackCookie` applied. A malformed encoding is treated as absent
 *  rather than thrown — a corrupt cookie must never 500 the route. */
function readOwnerFallbackCookie(
  cookieHeader: string | null,
  cookieName: string,
): string | undefined {
  const raw = readCookieValue(cookieHeader, cookieName);
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw) || undefined;
  } catch {
    return undefined;
  }
}

/** What the request proved about its holder, before any report is looked up.
 *  Extracted so the two authenticated purposes share ONE reading of the
 *  `?et=` / cookie / `?oa=` seam and differ only in what they DO about it. */
type Capability =
  /** A fresh, valid `?et=` — redeem it into cookies and bounce to a clean URL. */
  | {
      readonly kind: "handoff";
      readonly token: string;
      readonly maxAge: number;
      readonly oa: string | undefined;
    }
  /** A valid, already-redeemed capability cookie. */
  | {
      readonly kind: "held";
      readonly token: string;
      readonly claims: EditClaims;
      readonly oa: string | undefined;
    }
  /** No usable capability. `cause` decides funnel-vs-degrade — the rule is
   *  `funnelTarget`, which both authenticated purposes call. */
  | {
      readonly kind: "refused";
      readonly cause: EditDenialCause;
      readonly oa: string | undefined;
    };

/**
 * Read this request's capability for `surface`. Pure over `deps`; looks at
 * nothing but the URL and the `Cookie` header.
 *
 * Every asymmetry here is deliberate and pre-existing (see `decideEdit`'s
 * comments): the query token takes precedence over the cookie; an INVALID
 * query token is refused outright rather than falling back to a still-valid
 * cookie (unlike the view path's unlock cookie); a fresh query `oa=`
 * supersedes a cookie-carried one; and everything fails CLOSED on an unset
 * secret, because an HMAC accepts an empty key.
 */
function readCapability(
  url: URL,
  cookieHeader: string | null,
  slug: Slug,
  surface: Surface,
  deps: GateDeps,
): Capability {
  const oa = acceptOwnerFallback(
    url.searchParams.get("oa") ?? readOwnerFallbackCookie(cookieHeader, surface.ownerCookie),
    slug,
    deps,
  );
  const queryToken = url.searchParams.get("et") ?? undefined;
  if (deps.secret && queryToken) {
    const claims = readEditToken(queryToken, slug, deps.secret, deps.nowSeconds);
    // A token was PRESENTED and did not verify — a rejection, not an absence.
    if (!claims) return { kind: "refused", cause: "rejected", oa };
    return {
      kind: "handoff",
      token: queryToken,
      maxAge: Math.max(0, claims.exp - deps.nowSeconds),
      oa,
    };
  }
  const cookieToken = readCookieValue(cookieHeader, surface.capabilityCookie);
  const claims =
    deps.secret && cookieToken
      ? readEditToken(cookieToken, slug, deps.secret, deps.nowSeconds)
      : null;
  // A cookie that WAS present and failed to verify (expired, tampered, minted
  // under a rotated secret) is a rejection; no cookie at all — or no secret
  // with which to judge one — is an absence.
  if (!claims || !cookieToken) {
    return { kind: "refused", cause: cookieToken && deps.secret ? "rejected" : "absent", oa };
  }
  return { kind: "held", token: cookieToken, claims, oa };
}

/** Degrade an AUTHENTICATED request (`/edit` or, since ADR-0089, `/<slug>/view`)
 *  to the public viewer — through the owner `?access=` flow when a fallback is
 *  in hand — and ALWAYS leave a log line saying why.
 *
 *  Returns the shared `redirect` arm rather than an `EditDecision`, which is
 *  both narrower and true: this function has never produced anything else, and
 *  the narrower type is what lets the ownerView purpose reuse it instead of
 *  growing a second copy of the same degrade.
 *
 *  NOTE the event names stay `edit-degraded-to-view` /
 *  `owner-edit-degraded-to-view` even when the degrade came from the owner
 *  view. That is deliberate: they are what incident queries look for (ADR-0063
 *  Phase 5-E introduced them for exactly that), the degrade CLASS is identical
 *  — an authenticated surface fell back to the public viewer, possibly
 *  stranding an owner — and the `reason` field already distinguishes the
 *  cause. Renaming them would silently break the queries that exist. */
function degradedEdit(
  slug: string,
  oa: string | undefined,
  reason: EditDegradeReason,
  deps: GateDeps,
): { readonly kind: "redirect"; readonly to: string } {
  (deps.warn ?? console.warn)(editDegradeLine(slug, oa !== undefined, reason));
  return { kind: "redirect", to: degradeLocation(slug, oa) };
}

/** Why the edit capability was refused. The two are NOT interchangeable — see
 *  `funnelTarget`, which routes them differently for both authenticated
 *  purposes.
 *
 *  - `rejected`: a token WAS presented (query or cookie) and did not verify —
 *    expired, tampered with, or minted under a since-rotated secret.
 *  - `absent`: no token at all, or no secret with which to judge one. */
type EditDenialCause = "rejected" | "absent";

/** Where a denied AUTHENTICATED request should be funnelled — the app's ONE
 *  edit-token mint, `GET {appOrigin}/reports/{slug}/open` — or `undefined` when
 *  this denial is not one the mint can repair and the caller must degrade
 *  instead. The app re-authenticates the session and re-mints `et=` for
 *  canWrite users (owner or write-grantee), and bounces everyone else to its
 *  home ("/" → sign-in for anonymous visitors), so a grantee's road into an
 *  authenticated surface doesn't dead-end at the read-only viewer.
 *
 *  ONE implementation for BOTH authenticated purposes — `deniedEdit` and
 *  `decideOwnerView`. ADR-0089 §3 lists this rule among the two things the
 *  owner view "deliberately inherit[s] rather than re-decide[s] … a rule two
 *  production incidents paid for", and inheritance-by-COPY is how a rule gets
 *  re-decided by accident: the next reader fixes the copy in front of them and
 *  the ordering below silently forks. It is a shared function so that cannot
 *  happen, and so this comment documents the only implementation there is.
 *
 *  ORDERING (reordered 2026-08-06 — this used to answer `if (oa)` FIRST):
 *
 *  - `rejected`, and the funnel is available → FUNNEL, even for an owner
 *    holding a verified `oa`. A rejection says the capability round-trip is
 *    what broke, and the mint is the thing that repairs it. Answering `oa`
 *    first was safe only while `oa` could arrive on the query alone — it was
 *    then present exactly once, on the request that had just been minted. Now
 *    that it is cookie-carried it survives the whole session, so it also
 *    catches every LATER rejection: an expired cookie, a rotated secret, clock
 *    skew. Degrading those to read-only removes the recovery path in exactly
 *    the secret-rotation scenario Phase 5-E exists for, and leaves a
 *    still-entitled owner read-only for the fallback's remaining 24h.
 *  - `absent`, with a verified `oa` → NO funnel: the caller's `oa` outcome,
 *    unchanged (a degrade off /edit, read-only chrome off the owner view).
 *    Nothing was rejected, so nothing points at the mint round-trip; and the
 *    `oa` in hand is a WORKING capability for the read-only view rather than a
 *    gamble on another hop.
 *  - anything, with no funnel available (no secret / no appOrigin) → NO funnel:
 *    the caller's `oa` outcome if one is in hand, else the bare public viewer.
 *    This is what keeps the unlock wall unreachable for an owner even when the
 *    app origin is unset.
 *
 *  Loop safety: /open → /edit?et=… → arp_edit cookie → served; a non-writer
 *  exits at the app home, never bouncing back here. The funnel is guarded on
 *  BOTH secret and appOrigin: with no secret this origin can never validate
 *  any token /open mints (funnelling would guarantee /edit → /open → /edit),
 *  and with no appOrigin there is nowhere to send anyone. The residual loop
 *  (both secrets SET but misaligned, a non-owner grantee) is the PR #185
 *  incident class — the browser's redirect-loop breaker surfaces it instead of
 *  a silent read-only degrade. The reorder deliberately EXTENDS that residual
 *  loop to owners: a loud loop the operator can see beats an owner quietly
 *  parked in read-only, which is how the 2026-08-06 incident stayed invisible. */
function funnelTarget(
  slug: string,
  oa: string | undefined,
  cause: EditDenialCause,
  deps: GateDeps,
): string | undefined {
  const canFunnel = Boolean(deps.secret && deps.appOrigin);
  return canFunnel && (cause === "rejected" || !oa)
    ? `${deps.appOrigin}/reports/${slug}/open`
    : undefined;
}

/** The edit purpose's denied branch: the funnel when `funnelTarget` offers one,
 *  the `oa` degrade when it does not. The ordering rule itself lives on
 *  `funnelTarget`, which the owner view calls too. */
function deniedEdit(
  slug: string,
  oa: string | undefined,
  cause: EditDenialCause,
  deps: GateDeps,
): EditDecision {
  // NOT a degrade — the funnel is the happy path for a writer whose token
  // simply needs re-minting. It re-enters through the mint, so no warning.
  const funnel = funnelTarget(slug, oa, cause, deps);
  if (funnel) return { kind: "redirect", to: funnel };
  // Observability (claude-review #187): when an OWNER's edit-token round-trip
  // is denied and we degrade them to a read-only view (`oa` present), emit a
  // structured signal — the secret-misalignment class of incident is then
  // visible in logs rather than only inferable from user reports. Never logs
  // the token.
  return degradedEdit(slug, oa, "edit-token-denied", deps);
}
