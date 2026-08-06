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

/** Build the `Set-Cookie` value for the `arp_edit` cookie. `maxAgeSeconds` is the
 *  token's remaining life (`claims.exp - nowSeconds`) so the cookie never outlives
 *  the capability it carries — there is no independent expiry. */
function editCookie(slug: string, token: string, maxAgeSeconds: number): string {
  return `${EDIT_COOKIE}=${token}; Path=/${slug}/edit; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

/** The owner-fallback cookie. The value is percent-encoded (and decoded on
 *  read) so a token containing a `;`, `,` or space can never split the header
 *  — `searchParams.get("oa")` hands us the DECODED token. */
function ownerFallbackCookie(slug: string, oa: string, maxAgeSeconds: number): string {
  return `${EDIT_OWNER_COOKIE}=${encodeURIComponent(oa)}; Path=/${slug}/edit; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
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

/** Why an /edit request degraded to the viewer. Every value is a DISTINCT
 *  production failure mode — the incident that motivated this enum was
 *  indistinguishable from four other causes precisely because nothing logged
 *  a reason. */
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

/**
 * Where a route should send a visitor it cannot render for, and whether that
 * target carries an owner fallback (which selects the log event).
 *
 * ONE answer for every Decision shape, including the ones purpose "edit" can't
 * actually produce but whose types the route still has to narrow past. The
 * /edit loader used to have two answers: `decision.degradeTo` for its
 * document-load failures, and a hard-coded `/${params.slug}` — silently, with
 * no log line — in its defensive-narrowing branch (review #247 M-2). That is
 * the same "left one branch untouched" shape ADR-0063 criticises Phase 5-E for,
 * and it is how an owner ends up at the unlock wall.
 */
export function degradeTargetFor(
  decision: Decision,
  slug: string,
): { readonly to: string; readonly ownerFallback: boolean } {
  return decision.kind === "serve"
    ? {
        to: decision.degradeTo ?? `/${slug}`,
        ownerFallback: decision.ownerFallback ?? false,
      }
    : { to: `/${slug}`, ownerFallback: false };
}

export type Purpose = "view" | "edit";

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

export type Decision =
  /** Access granted and there is a clean version: stream it (view) / load the
   *  editor data for it (edit — `edit` carries the validated capability). */
  | {
      readonly kind: "serve";
      readonly report: Report;
      readonly version: ReportVersion;
      readonly edit?: { readonly token: string; readonly claims: EditClaims };
      /** purpose "edit" only — where the route must send the visitor if IT
       *  cannot render after all (the blob read / the shell split). Carries the
       *  owner `?access=` fallback when one is in play, so a route-side failure
       *  can't strand an owner at the unlock wall the way the gate's own
       *  degrades no longer can. */
      readonly degradeTo?: string;
      /** Whether `degradeTo` carries an owner fallback — selects the log event. */
      readonly ownerFallback?: boolean;
    }
  /** Access granted but the report is mid-scan → the ADR-0038 §2 holding page. */
  | { readonly kind: "interstitial" }
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

/** The one viewer gate: decide what the origin should do for `rawSlug` under
 *  `purpose`, given the request's query/cookie capabilities. Pure over `deps`
 *  (all I/O behind the injected ports); never throws. */
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

  return purpose === "edit"
    ? decideEdit(request, url, slug.value, deps)
    : decideView(request, url, slug.value, deps);
}

// --- purpose: "view" — the public route's decision chain (ADR-0038 + 0056) ---
async function decideView(
  request: Request,
  url: URL,
  slug: Slug,
  deps: GateDeps,
): Promise<Decision> {
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
): Promise<Decision> {
  const cookieHeader = request.headers.get("cookie");
  const queryToken = url.searchParams.get("et") ?? undefined;
  // The fallback owner access token `ownerOpenLocation` mints alongside `et=`
  // for actual owners. It arrives ONCE, on the query — and the 303 below
  // strips the query. So it is read from the query OR from the cookie the 303
  // persisted it into: without that, every degrade on the post-303 request was
  // blind to the fact that it was stranding an OWNER (the 2026-08-06 lockout).
  // A fresh query `oa=` always supersedes a cookie-carried one. Both are
  // VERIFIED before they count as a fallback (acceptOwnerFallback) — see there.
  const oa = acceptOwnerFallback(
    url.searchParams.get("oa") ?? readOwnerFallbackCookie(cookieHeader),
    slug,
    deps,
  );
  const cookieToken = readCookieValue(cookieHeader, EDIT_COOKIE);

  // Fail closed (denied) when `secret` is unset — same posture as the view
  // path's resolveAccessDecision. The query token takes precedence when both
  // are present — a fresh mint always wins over whatever cookie is already
  // sitting there. NOTE (deliberate, preserved asymmetry vs "view"): an
  // INVALID query token is denied outright — it does NOT fall back to a
  // still-valid cookie the way the view path's resolveAccessDecision falls
  // back to the unlock cookie. That is the pre-extraction behavior of both
  // loaders, kept intact behind the purpose parameter.
  if (deps.secret && queryToken) {
    const claims = readEditToken(queryToken, slug, deps.secret, deps.nowSeconds);
    if (!claims) return deniedEdit(slug, oa, deps);
    const maxAge = Math.max(0, claims.exp - deps.nowSeconds);
    return {
      kind: "setCookieAndRedirect",
      // Mint the arp_edit cookie — plus the owner fallback, so it SURVIVES the
      // clean-URL bounce — and 303. Drops both tokens out of the address
      // bar/history/referer, exactly like the view path's grant.
      cookies: [
        editCookie(slug, queryToken, maxAge),
        ...(oa ? [ownerFallbackCookie(slug, oa, maxAge)] : []),
      ],
      to: `/${slug}/edit`,
    };
  }
  const claims =
    deps.secret && cookieToken
      ? readEditToken(cookieToken, slug, deps.secret, deps.nowSeconds)
      : null;
  if (!claims || !cookieToken) return deniedEdit(slug, oa, deps);

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
    edit: { token: cookieToken, claims },
    degradeTo: degradeLocation(slug, oa),
    ownerFallback: oa !== undefined,
  };
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
 *  rather than thrown — a corrupt cookie must never 500 the edit route. */
function readOwnerFallbackCookie(cookieHeader: string | null): string | undefined {
  const raw = readCookieValue(cookieHeader, EDIT_OWNER_COOKIE);
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw) || undefined;
  } catch {
    return undefined;
  }
}

/** Degrade an /edit request to the viewer — through the owner `?access=` flow
 *  when a fallback is in hand — and ALWAYS leave a log line saying why. */
function degradedEdit(
  slug: string,
  oa: string | undefined,
  reason: EditDegradeReason,
  deps: GateDeps,
): Decision {
  (deps.warn ?? console.warn)(editDegradeLine(slug, oa !== undefined, reason));
  return { kind: "redirect", to: degradeLocation(slug, oa) };
}

/** The edit purpose's denied branch. With an `oa=` fallback present (an OWNER
 *  whose round-trip failed): degrade through the viewer's `?access=` owner
 *  flow, with the observability signal — unchanged. Otherwise (no token,
 *  expired/invalid token or cookie): funnel to the app's ONE edit-token mint,
 *  `GET {appOrigin}/reports/{slug}/open` — the app re-authenticates the
 *  session and re-mints `et=` for canWrite users (owner or write-grantee),
 *  and bounces everyone else to its home ("/" → sign-in for anonymous
 *  visitors), so a grantee's road into /edit no longer dead-ends at the
 *  read-only viewer.
 *
 *  Loop safety: /open → /edit?et=… → arp_edit cookie → served; a non-writer
 *  exits at the app home, never bouncing back here. The funnel is guarded on
 *  BOTH secret and appOrigin: with no secret this origin can never validate
 *  any token /open mints (funnelling would guarantee /edit → /open → /edit),
 *  and with no appOrigin there is nowhere to send anyone — both keep today's
 *  degrade to the public viewer. The residual loop (both secrets SET but
 *  misaligned, a non-owner grantee) is the PR #185 incident class — the
 *  browser's redirect-loop breaker surfaces it instead of a silent read-only
 *  degrade. */
function deniedEdit(slug: string, oa: string | undefined, deps: GateDeps): Decision {
  // Observability (claude-review #187): when an OWNER's edit-token round-trip
  // is denied and we degrade them to a read-only view (`oa` present), emit a
  // structured signal — the secret-misalignment class of incident is then
  // visible in logs rather than only inferable from user reports. Never logs
  // the token.
  if (oa) return degradedEdit(slug, oa, "edit-token-denied", deps);
  if (deps.secret && deps.appOrigin) {
    // NOT a degrade — the funnel is the happy path for a writer whose cookie
    // simply expired. It re-enters through the mint, so it needs no warning.
    return { kind: "redirect", to: `${deps.appOrigin}/reports/${slug}/open` };
  }
  return degradedEdit(slug, undefined, "edit-token-denied", deps);
}
