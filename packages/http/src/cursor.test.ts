import {
  err,
  folderId,
  folderIdToWire,
  makeFolderId,
  ok,
  type Result,
  validationError,
} from "arp-domain";
import { describe, expect, it } from "vitest";
import { parseCursorParams } from "./cursor";

const sp = (params: Record<string, string>) => new URLSearchParams(params);

const decodeOk = (s: string): Result<string, ReturnType<typeof validationError>> => ok(s);

describe("parseCursorParams", () => {
  it("defaults limit to 20 when absent", () => {
    const r = parseCursorParams(sp({}), decodeOk);
    expect(r.ok && r.value.limit).toBe(20);
  });

  it("clamps a limit above 100 down to 100", () => {
    const r = parseCursorParams(sp({ limit: "500" }), decodeOk);
    expect(r.ok && r.value.limit).toBe(100);
  });

  it("clamps a limit below 1 up to 1", () => {
    const r = parseCursorParams(sp({ limit: "0" }), decodeOk);
    expect(r.ok && r.value.limit).toBe(1);
  });

  it("falls back to the default on a non-numeric limit", () => {
    const r = parseCursorParams(sp({ limit: "nope" }), decodeOk);
    expect(r.ok && r.value.limit).toBe(20);
  });

  it("decodes starting_after via the given decoder", () => {
    const r = parseCursorParams(sp({ starting_after: "cursor-1" }), decodeOk);
    expect(r.ok && r.value.startingAfter).toBe("cursor-1");
  });

  it("decodes ending_before via the given decoder", () => {
    const r = parseCursorParams(sp({ ending_before: "cursor-2" }), decodeOk);
    expect(r.ok && r.value.endingBefore).toBe("cursor-2");
  });

  it("rejects passing both starting_after and ending_before (422)", () => {
    const r = parseCursorParams(sp({ starting_after: "a", ending_before: "b" }), decodeOk);
    expect(!r.ok && r.error.kind).toBe("ValidationError");
  });

  it("propagates a decode failure from starting_after", () => {
    const failingDecode = () => err(validationError("bad cursor"));
    const r = parseCursorParams(sp({ starting_after: "garbage" }), failingDecode);
    expect(!r.ok && r.error.kind).toBe("ValidationError");
  });

  it("propagates a decode failure from ending_before", () => {
    const failingDecode = () => err(validationError("bad cursor"));
    const r = parseCursorParams(sp({ ending_before: "garbage" }), failingDecode);
    expect(!r.ok && r.error.kind).toBe("ValidationError");
  });

  it("works with a real domain decoder (makeFolderId)", () => {
    const wire = folderIdToWire(folderId("00000000-0000-7000-8000-000000000001"));
    const r = parseCursorParams(sp({ starting_after: wire }), makeFolderId);
    expect(r.ok).toBe(true);
  });

  it("rejects a malformed folder id via makeFolderId", () => {
    const r = parseCursorParams(sp({ starting_after: "not-a-folder-id" }), makeFolderId);
    expect(!r.ok && r.error.kind).toBe("ValidationError");
  });
});
