import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HtmlBundleProcessor } from "./bundle-processor";
import { ReportHtmlEditabilityProbe } from "./editability-probe";

const enc = (s: string) => new TextEncoder().encode(s);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(
  path.resolve(__dirname, "../../report-html/src/fixtures/ai-readiness-report.html"),
  "utf-8",
);

describe("ReportHtmlEditabilityProbe", () => {
  const probe = new ReportHtmlEditabilityProbe();

  it("answers 'editable' for a real report document", () => {
    expect(probe.probe(enc(FIXTURE), false)).toBe("editable");
  });

  it("answers 'editable' for the fragment an agent uploads by accident", () => {
    // ADR-0062 Amendment 4: the fragment is the COMMON agent upload, so it is
    // the case the editor must handle, not the case it refuses.
    expect(probe.probe(enc("<h1>Findings</h1><p>no body tag</p>"), false)).toBe("editable");
  });

  it("answers 'unsplittable' for a body that never closes", () => {
    expect(probe.probe(enc("<html><body><p>hi</p></html>"), false)).toBe("unsplittable");
  });

  it("honors the sidecar branch the editor itself takes", () => {
    const deep = `<html><body>${"<div>".repeat(5000)}x${"</div>".repeat(5000)}</body></html>`;
    expect(probe.probe(enc(deep), false)).toBe("unparsable");
    expect(probe.probe(enc(deep), true)).toBe("editable");
  });

  it("decodes bytes as UTF-8 — the same encoding the entry document is stored with", () => {
    expect(probe.probe(enc("<html><body><p>café — ☕</p></body></html>"), false)).toBe("editable");
  });

  it("never throws, whatever the bytes are", () => {
    // A probe whose contract is "always answer" must not become a new crash
    // site: an upload is never rejected for being un-editable (ADR-0080).
    expect(() => probe.probe(new Uint8Array([0xff, 0xfe, 0x00, 0x01]), false)).not.toThrow();
  });
});

describe("the read path is unchanged by the probe (ADR-0038)", () => {
  // Editability is metadata ABOUT the bytes, never a transformation OF them.
  // This is the regression pin: whatever the verdict, the bytes the processor
  // hands the blob store — and therefore the bytes the viewer streams — are
  // byte-for-byte what was uploaded.
  const proc = new HtmlBundleProcessor();
  const probe = new ReportHtmlEditabilityProbe();

  const cases: readonly [name: string, html: string][] = [
    ["an editable document", FIXTURE],
    ["an unsplittable unclosed body", "<html><body><p>hi</p></html>"],
    [
      "an unparsable body",
      `<html><body>${"<div>".repeat(5000)}x${"</div>".repeat(5000)}</body></html>`,
    ],
  ];

  for (const [name, html] of cases) {
    it(`stores ${name} verbatim`, async () => {
      const uploaded = enc(html);
      const processed = await proc.process("report.html", uploaded);
      expect(processed.ok).toBe(true);
      if (!processed.ok) return;
      const stored = processed.value.files[0]?.bytes;
      // Probing must not consume, re-encode, normalize or reorder anything.
      probe.probe(uploaded, false);
      expect(stored).toEqual(uploaded);
      expect(new TextDecoder().decode(stored as Uint8Array)).toBe(html);
    });
  }
});
