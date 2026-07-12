import { describe, expect, it } from "vitest";
import { parseCommentPatch, parseJsonBody } from "./request";

const req = (body: string | null, ct: string | null = "application/json") =>
  new Request("https://example.test/", {
    method: "POST",
    headers: ct ? { "content-type": ct } : {},
    body,
  });

describe("parseJsonBody", () => {
  it("parses a JSON object body", async () => {
    const r = await parseJsonBody(req('{"a":1}'));
    expect(r.ok && r.value).toEqual({ a: 1 });
  });

  it("rejects a non-JSON content-type with UnsupportedMediaType (→415)", async () => {
    const r = await parseJsonBody(req("{}", "text/plain"));
    expect(!r.ok && r.error.kind).toBe("UnsupportedMediaType");
  });

  it("rejects a JSON array with ValidationError (→422)", async () => {
    const r = await parseJsonBody(req("[1,2,3]"));
    expect(!r.ok && r.error.kind).toBe("ValidationError");
  });

  it("rejects malformed JSON with ValidationError (→422)", async () => {
    const r = await parseJsonBody(req("{not valid"));
    expect(!r.ok && r.error.kind).toBe("ValidationError");
  });
});

describe("parseCommentPatch (resolve-vs-edit dispatch, ADR-0064 §7)", () => {
  it("classifies an absent body as resolve (the unchanged resolve path)", () => {
    const r = parseCommentPatch(undefined);
    expect(r.ok && r.value).toEqual({ kind: "resolve" });
  });

  it("classifies an empty JSON object as resolve", () => {
    const r = parseCommentPatch({});
    expect(r.ok && r.value).toEqual({ kind: "resolve" });
  });

  it("classifies a body-only patch as an edit", () => {
    const r = parseCommentPatch({ body: "fixed a typo" });
    expect(r.ok && r.value).toEqual({ kind: "edit", body: "fixed a typo", intent: undefined });
  });

  it("classifies an intent-only patch as an edit, validating the intent", () => {
    const r = parseCommentPatch({ intent: "enhancement" });
    expect(r.ok && r.value).toEqual({ kind: "edit", body: undefined, intent: "enhancement" });
  });

  it("classifies a body+intent patch as an edit", () => {
    const r = parseCommentPatch({ body: "new", intent: "add" });
    expect(r.ok && r.value).toEqual({ kind: "edit", body: "new", intent: "add" });
  });

  it("rejects a present-but-empty body with ValidationError (→422)", () => {
    const r = parseCommentPatch({ body: "   " });
    expect(!r.ok && r.error.kind).toBe("ValidationError");
  });

  it("rejects a present-but-non-string body with ValidationError (→422)", () => {
    const r = parseCommentPatch({ body: 42 });
    expect(!r.ok && r.error.kind).toBe("ValidationError");
  });

  it("rejects an invalid intent with ValidationError (→422)", () => {
    const r = parseCommentPatch({ intent: "bogus" });
    expect(!r.ok && r.error.kind).toBe("ValidationError");
  });
});
