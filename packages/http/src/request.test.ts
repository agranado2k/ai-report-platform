import { describe, expect, it } from "vitest";
import { parseJsonBody } from "./request";

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
