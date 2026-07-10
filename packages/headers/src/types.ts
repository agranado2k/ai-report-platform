export type SecureHeadersOptions = {
  /**
   * Optional override for the CSP `Report-To` endpoint. Defaults to
   * `${APP_ORIGIN}/csp-report` (the dashboard origin). The `/csp-report`
   * route itself lands in Phase 1.
   */
  readonly reportToUrl?: string;
};

/**
 * Options for `editViewHeaders` (ADR-0063 Phase 3) — the viewer origin's
 * second, authenticated CSP profile for `GET /<slug>/edit`.
 */
export type EditViewHeadersOptions = SecureHeadersOptions & {
  /**
   * The app-origin (`app.<domain>`) the editor's first-party JS is allowed
   * to call via `connect-src` — the edit-token-authenticated API the editor
   * reads/writes through (ADR-0063 Decision 3). REQUIRED: unlike the public
   * profile, this route needs an explicit, narrow widening rather than
   * `'self'` alone. Pass a bare origin (e.g. `https://app.centaurspec.com`);
   * a trailing slash is normalized away. Never resolves to `'*'` — a caller
   * cannot loosen this to a wildcard through this option.
   */
  readonly appOrigin: string;
};
