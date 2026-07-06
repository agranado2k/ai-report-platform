// Characterization tests for the dashboard origin's security headers (ADR-013).
// Pins the CURRENT values exactly, including the Trusted Types directives that
// are unique to the app origin (the viewer origin doesn't set them).
import { describe, expect, it } from "vitest";
import { appHeaders } from "./app-headers";

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

describe("appHeaders", () => {
  it("pins a single, stricter CSP (no 'unsafe-inline' on script-src, Clerk allowlisted)", () => {
    expect(appHeaders().get("Content-Security-Policy")).toBe(APP_CSP);
  });

  it("pins COOP + CORP same-origin (stricter than the viewer's same-site) + Origin-Agent-Cluster", () => {
    const h = appHeaders();
    expect(h.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(h.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(h.get("Origin-Agent-Cluster")).toBe("?1");
  });

  it("pins strict-origin-when-cross-origin Referrer-Policy (vs the viewer's no-referrer)", () => {
    expect(appHeaders().get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("pins Permissions-Policy, X-Content-Type-Options, and HSTS", () => {
    const h = appHeaders();
    expect(h.get("Permissions-Policy")).toBe(
      "camera=(), microphone=(), geolocation=(), usb=(), payment=(), accelerometer=(), " +
        "gyroscope=(), magnetometer=(), midi=(), serial=(), bluetooth=(), interest-cohort=()",
    );
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
    expect(h.get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
  });

  it("enforces Trusted Types for script with a default+react policy allowlist", () => {
    const h = appHeaders();
    expect(h.get("Require-Trusted-Types-For")).toBe("'script'");
    expect(h.get("Trusted-Types")).toBe("default react");
  });

  it("sets no default Cache-Control — dashboard loaders own their own", () => {
    expect(appHeaders().get("Cache-Control")).toBeNull();
  });

  it("threads an explicit reportToUrl into Report-To, defaulting otherwise", () => {
    const withOverride = appHeaders({ reportToUrl: "https://app.example.com/csp-report" });
    const reportTo = JSON.parse(withOverride.get("Report-To") ?? "{}");
    expect(reportTo.endpoints).toEqual([{ url: "https://app.example.com/csp-report" }]);

    const withoutOverride = JSON.parse(appHeaders().get("Report-To") ?? "{}");
    expect(withoutOverride.endpoints[0].url.endsWith("/csp-report")).toBe(true);
  });
});
