export type SecureHeadersOptions = {
  /**
   * Optional override for the CSP `Report-To` endpoint. Defaults to
   * `${APP_ORIGIN}/csp-report` (the dashboard origin). The `/csp-report`
   * route itself lands in Phase 1.
   */
  readonly reportToUrl?: string;
};

/**
 * Options for `authenticatedViewHeaders` (ADR-0063 Phase 3) — the viewer
 * origin's second, authenticated CSP profile. It serves every authenticated
 * first-party route on that origin: `GET /<slug>/edit` (the editor, ADR-0063)
 * and `GET /<slug>/view` (the owner view, ADR-0089).
 */
export type AuthenticatedViewHeadersOptions = SecureHeadersOptions & {
  /**
   * The app-origin (`app.<domain>`) the editor's first-party JS is allowed
   * to call via `connect-src` — the edit-token-authenticated API the editor
   * reads/writes through (ADR-0063 Decision 3). REQUIRED: unlike the public
   * profile, this route needs an explicit, narrow widening rather than
   * `'self'` alone. Pass a bare origin (e.g. `https://app.centaurspec.com`);
   * it is *validated*, not best-effort — `authenticatedViewHeaders` parses it with
   * `new URL()` and **throws** on a malformed URL, a non-`http(s)` scheme,
   * embedded credentials, or a non-local `http` origin (prod must be https),
   * then reduces it to the clean origin token (path/query/fragment/trailing
   * slash stripped). Never resolves to `'*'` — a caller cannot loosen this to
   * a wildcard, nor inject a CSP directive, through this option.
   */
  readonly appOrigin: string;
};
