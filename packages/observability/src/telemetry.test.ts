import { describe, expect, it } from "vitest";
import {
  isTelemetryEnabled,
  otlpSignalUrl,
  parseOtlpHeaders,
  resourceAttributes,
} from "./telemetry";

describe("otlpSignalUrl (ADR-0055) — per-signal URL assembly", () => {
  it("appends the signal path to the endpoint", () => {
    expect(otlpSignalUrl("https://gw.grafana.net/otlp", "/v1/traces")).toBe(
      "https://gw.grafana.net/otlp/v1/traces",
    );
  });
  it("strips trailing slash(es) so the path doesn't double up", () => {
    expect(otlpSignalUrl("https://gw.grafana.net/otlp/", "/v1/logs")).toBe(
      "https://gw.grafana.net/otlp/v1/logs",
    );
    expect(otlpSignalUrl("  https://gw.grafana.net/otlp//  ", "/v1/traces")).toBe(
      "https://gw.grafana.net/otlp/v1/traces",
    );
  });
});

describe("parseOtlpHeaders (ADR-0055) — explicit exporter auth", () => {
  it("parses Authorization, percent-decoding %20 (the bug that silently 401'd export)", () => {
    expect(parseOtlpHeaders("Authorization=Basic%20dGVzdDp0b2tlbg==")).toEqual({
      Authorization: "Basic dGVzdDp0b2tlbg==",
    });
  });
  it("leaves an already-literal space (and base64 +/=) untouched", () => {
    expect(parseOtlpHeaders("Authorization=Basic dGVzdA+/==")).toEqual({
      Authorization: "Basic dGVzdA+/==",
    });
  });
  it("parses multiple comma-separated pairs", () => {
    expect(parseOtlpHeaders("a=1,b=2")).toEqual({ a: "1", b: "2" });
  });
  it("returns {} for undefined / empty / malformed", () => {
    expect(parseOtlpHeaders(undefined)).toEqual({});
    expect(parseOtlpHeaders("")).toEqual({});
    expect(parseOtlpHeaders("noequalssign")).toEqual({});
  });
});

describe("isTelemetryEnabled — fail-open gate (ADR-0055)", () => {
  it("is disabled when no OTLP endpoint is configured (app still boots)", () => {
    expect(isTelemetryEnabled({})).toBe(false);
    expect(isTelemetryEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: "  " })).toBe(false);
  });
  it("is enabled once an OTLP endpoint is present", () => {
    expect(
      isTelemetryEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: "https://otlp.grafana.net/otlp" }),
    ).toBe(true);
  });
});

describe("resourceAttributes (ADR-0055)", () => {
  it("emits service.version + deployment.environment only when provided", () => {
    expect(
      resourceAttributes({ service: "arp-app", version: "2.0.0", environment: "prod" }),
    ).toEqual({ "service.version": "2.0.0", "deployment.environment": "prod" });
    expect(resourceAttributes({ service: "arp-app" })).toEqual({});
  });
});
