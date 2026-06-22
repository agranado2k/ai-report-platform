import { describe, expect, it } from "vitest";
import { folderId } from "./brand";
import { folderIdToWire, makeFolderId } from "./folder-id";

describe("makeFolderId / folderIdToWire", () => {
  const uuid = "019ed70f-491d-707a-a263-4c31243f0c9f";

  it("round-trips a folder id through the wire codec", () => {
    const wire = folderIdToWire(folderId(uuid));
    expect(wire.startsWith("folder_")).toBe(true);
    const back = makeFolderId(wire);
    expect(back.ok && back.value).toBe(uuid);
  });

  it("rejects a bare UUID — the wire form must be prefixed (ADR-0052 clean break)", () => {
    const r = makeFolderId(uuid);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("ValidationError");
  });

  it("rejects a non-id value with a ValidationError", () => {
    const r = makeFolderId("not-an-id");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("ValidationError");
  });

  it("rejects an empty string", () => {
    expect(makeFolderId("").ok).toBe(false);
  });
});
