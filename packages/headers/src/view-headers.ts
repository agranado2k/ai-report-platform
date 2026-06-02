import { HSTS, PERMISSIONS_POLICY, reportToHeader, resolveReportToUrl } from "./permissions-policy";
import type { SecureHeadersOptions } from "./types";

const VIEW_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
  "worker-src 'self'",
  "report-to csp-endpoint",
].join("; ");

const VIEW_CSP_SANDBOX =
  "sandbox allow-forms allow-scripts allow-popups allow-popups-to-escape-sandbox";

const VIEW_CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
  "worker-src 'self'",
  "report-to csp-endpoint",
].join("; ");

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
