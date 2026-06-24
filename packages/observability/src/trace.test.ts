import { describe, expect, it } from "vitest";
import { activeTraceId } from "./trace";

describe("activeTraceId (ADR-0055)", () => {
  it("returns undefined when no span is active (telemetry off / outside a request)", () => {
    // No OTel SDK initialized in the unit env → no active span.
    expect(activeTraceId()).toBeUndefined();
  });
});
