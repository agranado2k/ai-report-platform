import { HSTS, PERMISSIONS_POLICY, reportToHeader, resolveReportToUrl } from "./permissions-policy";
import type { SecureHeadersOptions } from "./types";

const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.clerk.accounts.dev https://clerk.accounts.dev",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
  "worker-src 'self'",
  "report-to csp-endpoint",
].join("; ");

/**
 * Security headers for the dashboard origin (`app.<domain>`).
 *
 * Same baseline as the viewer (ADR-013) but tightened where we control
 * the content:
 *   - No `'unsafe-inline'` in `script-src` — every dashboard script is
 *     ours, no user content runs here.
 *   - `Cross-Origin-Resource-Policy: same-origin` (stricter than view).
 *   - `Referrer-Policy: strict-origin-when-cross-origin` so outbound
 *     links can still carry origin info (useful for analytics in v1.1).
 *   - **Trusted Types enforced** via `Require-Trusted-Types-For: 'script'`
 *     plus a `Trusted-Types` allowlist of policy names — blocks DOM-XSS
 *     even if a 3rd-party lib goes rogue.
 *   - No default `Cache-Control` — dashboard loaders set their own.
 */
export function appHeaders(opts: SecureHeadersOptions = {}): Headers {
  const h = new Headers();
  h.set("Content-Security-Policy", APP_CSP);
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  h.set("Cross-Origin-Resource-Policy", "same-origin");
  h.set("Origin-Agent-Cluster", "?1");
  h.set("Referrer-Policy", "strict-origin-when-cross-origin");
  h.set("Permissions-Policy", PERMISSIONS_POLICY);
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Strict-Transport-Security", HSTS);
  h.set("Require-Trusted-Types-For", "'script'");
  h.set("Trusted-Types", "default react");
  h.set("Report-To", reportToHeader(resolveReportToUrl(opts.reportToUrl)));
  return h;
}
