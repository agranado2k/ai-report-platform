// Characterization tests for the viewer origin's security headers (ADR-013).
// These pin the CURRENT header values exactly; a failing test here means a
// header changed, which is a decision to make deliberately, not a surprise.
import { describe, expect, it } from "vitest";
import { viewHeaders } from "./view-headers";

const ENFORCING_CSP = [
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

const SANDBOX_CSP = "sandbox allow-forms allow-scripts allow-popups allow-popups-to-escape-sandbox";

const REPORT_ONLY_CSP = [
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

describe("viewHeaders", () => {
  it("appends the enforcing CSP + the sandbox CSP as two Content-Security-Policy values", () => {
    const h = viewHeaders();
    // Headers.append() + .get() joins multiple values with ", " (WHATWG Fetch).
    expect(h.get("Content-Security-Policy")).toBe(`${ENFORCING_CSP}, ${SANDBOX_CSP}`);
  });

  it("pins the report-only CSP (stricter: no 'unsafe-inline' on script/style)", () => {
    expect(viewHeaders().get("Content-Security-Policy-Report-Only")).toBe(REPORT_ONLY_CSP);
  });

  it("pins COOP same-origin, CORP same-site, and Origin-Agent-Cluster", () => {
    const h = viewHeaders();
    expect(h.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(h.get("Cross-Origin-Resource-Policy")).toBe("same-site");
    expect(h.get("Origin-Agent-Cluster")).toBe("?1");
  });

  it("pins Referrer-Policy, Permissions-Policy, X-Content-Type-Options, HSTS", () => {
    const h = viewHeaders();
    expect(h.get("Referrer-Policy")).toBe("no-referrer");
    expect(h.get("Permissions-Policy")).toBe(
      "camera=(), microphone=(), geolocation=(), usb=(), payment=(), accelerometer=(), " +
        "gyroscope=(), magnetometer=(), midi=(), serial=(), bluetooth=(), interest-cohort=()",
    );
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
    expect(h.get("Strict-Transport-Security")).toBe("max-age=63072000; includeSubDomains; preload");
  });

  it("pins the default Cache-Control (private, short-lived, revalidated)", () => {
    expect(viewHeaders().get("Cache-Control")).toBe("private, max-age=60, must-revalidate");
  });

  it("lets a caller override Cache-Control per-response (e.g. /health → no-store)", () => {
    const h = viewHeaders();
    h.set("Cache-Control", "no-store");
    expect(h.get("Cache-Control")).toBe("no-store");
  });

  it("defaults the Report-To endpoint to the localhost dev fallback when unconfigured", () => {
    const h = viewHeaders({ reportToUrl: undefined });
    const reportTo = JSON.parse(h.get("Report-To") ?? "{}");
    expect(reportTo.group).toBe("csp-endpoint");
    expect(reportTo.max_age).toBe(10886400);
    expect(reportTo.endpoints[0].url.endsWith("/csp-report")).toBe(true);
  });

  it("threads an explicit reportToUrl straight into the Report-To header", () => {
    const h = viewHeaders({ reportToUrl: "https://view.example.com/csp-report" });
    const reportTo = JSON.parse(h.get("Report-To") ?? "{}");
    expect(reportTo.endpoints).toEqual([{ url: "https://view.example.com/csp-report" }]);
  });
});
