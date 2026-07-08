import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Shell } from "arp-report-html";
import { splitShell } from "arp-report-html";
import { describe, expect, it } from "vitest";
import { buildIframeDocument, IFRAME_INJECTED_CSS } from "./iframe-document";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(
  __dirname,
  "../../../../packages/report-html/src/fixtures/ai-readiness-report.html",
);

function makeShell(overrides: Partial<Shell> = {}): Shell {
  return {
    pre:
      '<!doctype html><html><head><meta charset="utf-8"><style>body{color:red}</style></head>' +
      '<body class="report" data-theme="dark">',
    post: "</body></html>",
    ...overrides,
  };
}

describe("buildIframeDocument", () => {
  it("inserts the CSP meta tag as the first child of <head>, before the report's own <style>", () => {
    const doc = buildIframeDocument(makeShell());
    const headStart = doc.indexOf("<head>") + "<head>".length;
    const cspIndex = doc.indexOf("Content-Security-Policy");
    const reportStyleIndex = doc.indexOf("body{color:red}");
    expect(cspIndex).toBeGreaterThan(-1);
    expect(reportStyleIndex).toBeGreaterThan(-1);
    // CSP meta immediately follows <head>, with nothing but our meta tag
    // between it and the next tag.
    expect(doc.slice(headStart, headStart + 5)).toBe("<meta");
    expect(cspIndex).toBeLessThan(reportStyleIndex);
  });

  it("locks the CSP down to no script/fetch, same-origin+inline style, same-origin+data images/fonts", () => {
    const doc = buildIframeDocument(makeShell());
    const match = /content="([^"]*)"/.exec(doc);
    expect(match).not.toBeNull();
    const content = match?.[1] ?? "";
    expect(content).toContain("default-src 'none'");
    expect(content).toContain("style-src 'self' 'unsafe-inline'");
    expect(content).toContain("img-src 'self' data:");
    expect(content).toContain("font-src 'self' data:");
    expect(content).toContain("base-uri 'none'");
    // No script-src override, and no 'unsafe-inline'/'unsafe-eval' for
    // scripts anywhere in the policy — default-src 'none' is the only
    // thing governing scripts.
    expect(content).not.toContain("script-src");
  });

  it("appends the comment-highlight + auto-<p> safety-net style just before </head>", () => {
    const doc = buildIframeDocument(makeShell());
    const headCloseIndex = doc.indexOf("</head>");
    const injectedIndex = doc.indexOf(".comment-highlight");
    expect(injectedIndex).toBeGreaterThan(-1);
    expect(injectedIndex).toBeLessThan(headCloseIndex);
    expect(doc).toContain(IFRAME_INJECTED_CSS);
  });

  it("preserves the shell's <body> attributes/classes verbatim", () => {
    const doc = buildIframeDocument(makeShell());
    expect(doc).toContain('<body class="report" data-theme="dark">');
  });

  it("produces an empty <body>...</body> — PM mounts and populates it itself", () => {
    const doc = buildIframeDocument(makeShell());
    expect(doc).toContain('data-theme="dark"></body>');
  });

  it("preserves shell.pre and shell.post content exactly (nothing dropped or mutated)", () => {
    const shell = makeShell();
    const doc = buildIframeDocument(shell);
    expect(doc).toContain('<meta charset="utf-8">');
    expect(doc.endsWith(shell.post)).toBe(true);
  });

  it("falls back to a synthesized head when shell.pre has no <head>...</head> (defensive)", () => {
    const shell: Shell = { pre: '<body class="x">', post: "</body>" };
    const doc = buildIframeDocument(shell);
    expect(doc).toContain("Content-Security-Policy");
    expect(doc).toContain(".comment-highlight");
    expect(doc).toContain('<body class="x">');
    expect(doc).toContain("</body>");
  });

  it("wraps the real fixture's shell without throwing and keeps its <style> content intact", () => {
    const original = readFileSync(FIXTURE_PATH, "utf-8");
    const { shell } = splitShell(original);
    const doc = buildIframeDocument(shell);
    expect(doc).toContain("Content-Security-Policy");
    expect(doc).toContain(".role-head { display: flex;");
    expect(doc).toContain(".comment-highlight");
  });
});
