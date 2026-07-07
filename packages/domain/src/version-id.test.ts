import { describe, expect, it } from "vitest";
import { versionId } from "./brand";
import { makeVersionId, versionIdToWire } from "./version-id";

describe("makeVersionId / versionIdToWire", () => {
  const uuid = "019ed70f-491d-707a-a263-4c31243f0c9f";

  it("round-trips a version id through the wire codec", () => {
    const wire = versionIdToWire(versionId(uuid));
    expect(wire.startsWith("version_")).toBe(true);
    const back = makeVersionId(wire);
    expect(back.ok && back.value).toBe(uuid);
  });

  it("rejects a bare UUID — the wire form must be prefixed (ADR-0052 clean break)", () => {
    const r = makeVersionId(uuid);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("ValidationError");
  });

  it("rejects a non-id value with a ValidationError", () => {
    const r = makeVersionId("not-an-id");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("ValidationError");
  });

  it("rejects an empty string", () => {
    expect(makeVersionId("").ok).toBe(false);
  });
});
