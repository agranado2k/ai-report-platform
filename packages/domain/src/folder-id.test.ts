import { describe, expect, it } from "vitest";
import { makeFolderId } from "./folder-id";

describe("makeFolderId", () => {
  it("accepts a well-formed UUID", () => {
    const r = makeFolderId("019ed70f-491d-707a-a263-4c31243f0c9f");
    expect(r.ok && r.value).toBe("019ed70f-491d-707a-a263-4c31243f0c9f");
  });

  it("rejects a non-UUID value with a ValidationError", () => {
    const r = makeFolderId("not-a-uuid");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("ValidationError");
  });

  it("rejects an empty string", () => {
    expect(makeFolderId("").ok).toBe(false);
  });
});
