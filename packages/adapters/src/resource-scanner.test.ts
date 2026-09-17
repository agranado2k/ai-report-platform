import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VIEW_CSP_ALLOWLIST } from "arp-headers/view";
import { describe, expect, it } from "vitest";
import { HtmlBundleProcessor } from "./bundle-processor";
import { ReportHtmlResourceScanner } from "./resource-scanner";

const enc = (s: string) => new TextEncoder().encode(s);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  readFileSync(path.resolve(__dirname, `../../report-html/src/fixtures/${name}`), "utf-8");

describe("ReportHtmlResourceScanner", () => {
  const scanner = new ReportHtmlResourceScanner();

  it("says nothing about a self-contained report", () => {
    expect(scanner.scan(enc(fixture("ai-readiness-report.html")))).toEqual([]);
  });

  it("names an external resource the viewer's CSP will block", () => {
    const html = '<html><body><script src="https://unpkg.com/x.js"></script></body></html>';
    expect(scanner.scan(enc(html))).toEqual([
      {
        url: "https://unpkg.com/x.js",
        directive: "script-src",
        allowed: VIEW_CSP_ALLOWLIST.scriptSrc,
      },
    ]);
  });

  it("clears a resource on the ADR-0088 allowlist", () => {
    const host = VIEW_CSP_ALLOWLIST.scriptSrc[0];
    const html = `<html><body><script src="${host}/ajax/libs/d3/7.9.0/d3.min.js"></script></body></html>`;
    expect(scanner.scan(enc(html))).toEqual([]);
  });

  it("decodes bytes as UTF-8 — the same encoding the entry document is stored with", () => {
    const html =
      '<html><body><p>café ☕</p><img src="https://cdn.test/a.png" alt=""></body></html>';
    expect(scanner.scan(enc(html)).map((r) => r.url)).toEqual(["https://cdn.test/a.png"]);
  });

  it("never throws, whatever the bytes are", () => {
    // An upload is never rejected for what it references, so asking the
    // question must not become a new crash site on the write path.
    expect(() => scanner.scan(new Uint8Array([0xff, 0xfe, 0x00, 0x01]))).not.toThrow();
    expect(() => scanner.scan(enc(""))).not.toThrow();
  });
});

describe("the read path is unchanged by the resource scan (ADR-0038)", () => {
  // The regression pin its two sibling probes carry, for the same reason: the
  // scan is metadata ABOUT the bytes, never a transformation OF them. A
  // document that reaches for unpkg is stored and served exactly as uploaded —
  // nothing here rewrites a URL to an allowlisted host.
  const proc = new HtmlBundleProcessor();
  const scanner = new ReportHtmlResourceScanner();

  it("stores a document full of blocked references verbatim", async () => {
    const html =
      '<html><head><link rel="stylesheet" href="https://unpkg.com/a.css"></head>' +
      '<body><img src="https://cdn.test/b.png" alt=""></body></html>';
    const uploaded = enc(html);
    const processed = await proc.process("report.html", uploaded);
    expect(processed.ok).toBe(true);
    if (!processed.ok) return;
    expect(scanner.scan(uploaded)).toHaveLength(2);
    expect(processed.value.files[0]?.bytes).toEqual(uploaded);
    expect(new TextDecoder().decode(processed.value.files[0]?.bytes as Uint8Array)).toBe(html);
  });
});
