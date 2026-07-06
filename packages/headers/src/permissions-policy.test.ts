// Characterization tests for the shared header building blocks (ADR-013). These
// pin the CURRENT values exactly — any change here is a deliberate header change,
// not an accidental one.
import { describe, expect, it } from "vitest";
import { HSTS, PERMISSIONS_POLICY, reportToHeader, resolveReportToUrl } from "./permissions-policy";

describe("PERMISSIONS_POLICY", () => {
  it("locks every powerful feature to no origin, including the FLoC opt-out", () => {
    expect(PERMISSIONS_POLICY).toBe(
      "camera=(), microphone=(), geolocation=(), usb=(), payment=(), accelerometer=(), " +
        "gyroscope=(), magnetometer=(), midi=(), serial=(), bluetooth=(), interest-cohort=()",
    );
  });
});

describe("HSTS", () => {
  it("pins a 2-year max-age with subdomains + preload", () => {
    expect(HSTS).toBe("max-age=63072000; includeSubDomains; preload");
  });
});

describe("reportToHeader", () => {
  it("builds the Reporting API v1 group envelope for the given endpoint", () => {
    expect(JSON.parse(reportToHeader("https://app.example.com/csp-report"))).toEqual({
      group: "csp-endpoint",
      max_age: 10886400,
      endpoints: [{ url: "https://app.example.com/csp-report" }],
    });
  });
});

describe("resolveReportToUrl", () => {
  it("returns the explicit override verbatim, ignoring env entirely", () => {
    // Passing a deliberately-inconsistent env proves the override short-circuits
    // before the env is even consulted.
    expect(
      resolveReportToUrl("https://override.example.com/hook", { APP_ORIGIN: "https://ignored" }),
    ).toBe("https://override.example.com/hook");
  });

  it("derives the URL from an injected APP_ORIGIN when no override is given", () => {
    expect(resolveReportToUrl(undefined, { APP_ORIGIN: "https://app.example.com" })).toBe(
      "https://app.example.com/csp-report",
    );
  });

  it("falls back to the localhost default when no override and no APP_ORIGIN are available", () => {
    // An explicit empty env (not real process.env) — this exercises the default
    // fallback deterministically, without ever reading or mutating process.env.
    expect(resolveReportToUrl(undefined, {})).toBe("https://app.localhost/csp-report");
  });

  it("reads real process.env.APP_ORIGIN when no env is injected (the production path)", () => {
    // No env argument at all — falls through to the real process.env read. We
    // don't assert a specific value (CI may or may not set APP_ORIGIN); we only
    // pin that the function still resolves to a non-empty CSP report URL either
    // way, so the injectable-fallback refactor didn't change the default wiring.
    const url = resolveReportToUrl();
    expect(url.endsWith("/csp-report")).toBe(true);
  });
});
