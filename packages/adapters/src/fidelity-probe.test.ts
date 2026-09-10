import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HtmlBundleProcessor } from "./bundle-processor";
import { ReportHtmlFidelityProbe } from "./fidelity-probe";

const enc = (s: string) => new TextEncoder().encode(s);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  readFileSync(path.resolve(__dirname, `../../report-html/src/fixtures/${name}`), "utf-8");

const REPORT = fixture("ai-readiness-report.html");
const DECK = fixture("interactive-deck.html");

describe("ReportHtmlFidelityProbe", () => {
  const probe = new ReportHtmlFidelityProbe();

  it("answers 'lossless' for a real report document", () => {
    expect(probe.probe(enc(REPORT), false)?.fidelity).toBe("lossless");
  });

  it("answers 'lossy' for the interactive deck, naming what a save would drop", () => {
    // The motivating document of PRD #356: it OPENS in the editor and would be
    // republished without its script or its diagram.
    const verdict = probe.probe(enc(DECK), false);
    expect(verdict?.fidelity).toBe("lossy");
    expect(verdict?.lostElements).toContain("script");
    expect(verdict?.lostElements).toContain("svg");
  });

  it("honors the sidecar branch — an editor-origin version is lossless unparsed", () => {
    expect(probe.probe(enc(DECK), true)).toEqual({
      fidelity: "lossless",
      lostElements: [],
      lostAttributes: [],
    });
  });

  it("answers UNKNOWN (null) when there is no round trip to run", () => {
    expect(probe.probe(enc("<html><body><p>hi</p></html>"), false)).toBeNull();
  });

  it("decodes bytes as UTF-8 — the same encoding the entry document is stored with", () => {
    expect(probe.probe(enc("<html><body><p>café — ☕</p></body></html>"), false)?.fidelity).toBe(
      "lossless",
    );
  });

  it("never throws, whatever the bytes are", () => {
    // An upload is never rejected for being lossy, so this must never become a
    // new crash site on the write path (ADR-0089).
    expect(() => probe.probe(new Uint8Array([0xff, 0xfe, 0x00, 0x01]), false)).not.toThrow();
  });
});

describe("the read path is unchanged by the fidelity probe (ADR-0038)", () => {
  // The regression pin, extended to the input a "helpful" fixer would be most
  // tempted to rewrite: a document the editor is about to be told it would
  // damage. Fidelity is metadata ABOUT the bytes, never a transformation OF
  // them — the deck is stored and served exactly as uploaded.
  const proc = new HtmlBundleProcessor();
  const probe = new ReportHtmlFidelityProbe();

  const cases: readonly [name: string, html: string][] = [
    ["a lossless report", REPORT],
    ["a lossy interactive deck", DECK],
    ["bytes with no honest verdict", "<html><body><p>hi</p></html>"],
  ];

  for (const [name, html] of cases) {
    it(`stores ${name} verbatim`, async () => {
      const uploaded = enc(html);
      const processed = await proc.process("report.html", uploaded);
      expect(processed.ok).toBe(true);
      if (!processed.ok) return;
      const stored = processed.value.files[0]?.bytes;
      probe.probe(uploaded, false);
      expect(stored).toEqual(uploaded);
      expect(new TextDecoder().decode(stored as Uint8Array)).toBe(html);
    });
  }
});
