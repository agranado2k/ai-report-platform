import { describe, expect, it } from "vitest";
import { decodeExternalId, encodeExternalId } from "./external-id";

describe("external-id codec", () => {
  it("encodes to <prefix>_ + 22 base62 chars", () => {
    const wire = encodeExternalId("folder", "019ed70f-492f-760e-933a-68067e84bfe3");
    expect(wire.startsWith("folder_")).toBe(true);
    expect(wire.slice("folder_".length)).toMatch(/^[0-9A-Za-z]{22}$/);
  });

  it("round-trips a normal uuid", () => {
    const uuid = "019ed70f-492f-760e-933a-68067e84bfe3";
    const back = decodeExternalId("folder", encodeExternalId("folder", uuid), "folderId");
    expect(back.ok && back.value).toBe(uuid);
  });

  it("round-trips a leading-zero uuid (fixed-width padding)", () => {
    const uuid = "00000000-0000-7000-8000-000000000001";
    const wire = encodeExternalId("report", uuid);
    expect(wire.slice("report_".length).length).toBe(22); // padded, not truncated
    const back = decodeExternalId("report", wire, "reportId");
    expect(back.ok && back.value).toBe(uuid);
  });

  it("round-trips the all-zero uuid", () => {
    const uuid = "00000000-0000-0000-0000-000000000000";
    const back = decodeExternalId("folder", encodeExternalId("folder", uuid), "folderId");
    expect(back.ok && back.value).toBe(uuid);
  });

  it("rejects a bare uuid (clean break — no unprefixed form)", () => {
    const r = decodeExternalId("folder", "019ed70f-492f-760e-933a-68067e84bfe3", "folderId");
    expect(!r.ok && r.error.kind).toBe("ValidationError");
  });

  it("rejects the wrong entity prefix", () => {
    const wire = encodeExternalId("report", "019ed70f-492f-760e-933a-68067e84bfe3");
    const r = decodeExternalId("folder", wire, "folderId");
    expect(!r.ok && r.error.kind).toBe("ValidationError");
  });

  it("rejects wrong length / bad chars / overflow", () => {
    expect(decodeExternalId("folder", "folder_tooShort", "folderId").ok).toBe(false);
    expect(decodeExternalId("folder", `folder_${"!".repeat(22)}`, "folderId").ok).toBe(false);
    // 22 'z' = 62^22-ish > 2^128 → must reject (can't be a 128-bit uuid)
    expect(decodeExternalId("folder", `folder_${"z".repeat(22)}`, "folderId").ok).toBe(false);
  });
});
