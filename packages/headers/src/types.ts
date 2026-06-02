export type SecureHeadersOptions = {
  /**
   * Optional override for the CSP `Report-To` endpoint. Defaults to
   * `${APP_ORIGIN}/csp-report` (the dashboard origin). The `/csp-report`
   * route itself lands in Phase 1.
   */
  readonly reportToUrl?: string;
};
