import { describe, expect, it } from "vitest";
import { HtmlBundleProcessor } from "./bundle-processor";

const enc = (s: string) => new TextEncoder().encode(s);

describe("HtmlBundleProcessor", () => {
  const proc = new HtmlBundleProcessor();

  it("wraps the upload as a single index.html bundle + hashes it", async () => {
    const r = await proc.process("whatever.html", enc("<h1>hi</h1>"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.entryDocument).toBe("index.html");
      expect(r.value.files).toHaveLength(1);
      expect(r.value.files[0]?.path).toBe("index.html");
      expect(r.value.sizeBytes).toBe(11);
      expect(r.value.contentHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("is deterministic (same bytes → same hash) and differs by content", async () => {
    const a = await proc.process("f", enc("<p>a</p>"));
    const b = await proc.process("f", enc("<p>a</p>"));
    const c = await proc.process("f", enc("<p>b</p>"));
    expect(a.ok && b.ok && a.value.contentHash === b.value.contentHash).toBe(true);
    expect(a.ok && c.ok && a.value.contentHash !== c.value.contentHash).toBe(true);
  });

  it("rejects an empty upload", async () => {
    const r = await proc.process("f", enc(""));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("ValidationError");
  });
});
