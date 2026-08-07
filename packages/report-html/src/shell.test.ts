import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { reinjectShell, splitShell } from "./shell.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, "./fixtures/ai-readiness-report.html");
const loadFixtureHtml = () => readFileSync(FIXTURE_PATH, "utf-8");

describe("splitShell / reinjectShell", () => {
  it("round-trips the real fixture byte-identically when the body is unchanged", () => {
    const original = loadFixtureHtml();
    const { shell, bodyHtml } = splitShell(original);

    expect(bodyHtml).toContain('class="shell"');
    expect(bodyHtml).toContain("Executive summary");
    expect(shell.pre).toContain("<style>");
    expect(shell.pre).not.toContain("Executive summary");

    const reconstituted = reinjectShell(shell, bodyHtml);
    expect(reconstituted).toBe(original);
    expect(reconstituted.length).toBe(original.length);
  });

  it("re-injecting a modified body only changes the body region", () => {
    const original = loadFixtureHtml();
    const { shell, bodyHtml } = splitShell(original);
    const modifiedBody = bodyHtml.replace("Executive summary", "Executive Summary EDITED");

    const result = reinjectShell(shell, modifiedBody);

    expect(result).not.toBe(original);
    expect(result).toContain("Executive Summary EDITED");
    expect(result.startsWith(shell.pre)).toBe(true);
    expect(result.endsWith(shell.post)).toBe(true);
  });

  it("throws when no </body> closing tag is present", () => {
    expect(() => splitShell("<html><body>unterminated")).toThrow(/<\/body>/);
  });
});

// ── Body-less documents (ADR-0062 Amendment 4) ──────────────────────────────
//
// An agent that publishes `<html><head>…</head><h1>…` — no explicit <body> —
// produces a document browsers render perfectly (they synthesise the body) but
// that splitShell used to reject outright, making the report permanently
// uneditable. That is the state report isK1rs7pL4 shipped in.
//
// The shell/body boundary does not actually require the <body> TAG; it requires
// knowing where presentation ends and content begins. `</head>` marks that just
// as precisely, and a document with neither is all content. What must NOT
// happen is the <head> falling into the editable body — the schema parser would
// mangle the <style> rules and the first save would destroy the report's
// styling, which is far worse than refusing to open it.
describe("splitShell — documents with no <body> tag", () => {
  it("splits at </head>, keeping the presentation shell OUT of the editable body", () => {
    const html = `<html><head><style>p{color:red}</style></head>\n<h1>Title</h1><p>Body</p>\n</html>`;

    const { shell, bodyHtml } = splitShell(html);

    // The style rules stay opaque — the exact regression that would silently
    // strip a report's CSS on its first save.
    expect(shell.pre).toContain("<style>p{color:red}</style>");
    expect(bodyHtml).not.toContain("<style>");
    expect(bodyHtml).toContain("<h1>Title</h1>");
  });

  it("keeps a trailing </html> in the shell, not in the editable body", () => {
    const { shell, bodyHtml } = splitShell(`<html><head></head><p>x</p></html>`);

    expect(bodyHtml).toBe("<p>x</p>");
    expect(shell.post).toBe("</html>");
  });

  it("treats a bare fragment with no head at all as entirely body", () => {
    const { shell, bodyHtml } = splitShell(`<h1>Fragment</h1><p>No wrapper at all.</p>`);

    expect(shell.pre).toBe("");
    expect(shell.post).toBe("");
    expect(bodyHtml).toBe(`<h1>Fragment</h1><p>No wrapper at all.</p>`);
  });

  it("round-trips a body-less document byte-identically through reinjectShell", () => {
    const original = `<html><head><meta charset="utf-8"><title>T</title></head>\n<h1>Hi</h1>\n</html>`;
    const { shell, bodyHtml } = splitShell(original);

    expect(reinjectShell(shell, bodyHtml)).toBe(original);
  });

  it("still prefers an explicit <body> when one is present", () => {
    const { shell, bodyHtml } = splitShell(`<html><head></head><body><p>x</p></body></html>`);

    expect(shell.pre).toContain("<body>");
    expect(bodyHtml).toBe("<p>x</p>");
  });
});

// ── Adversarial + optional-end-tag boundary finding (review of PR #255) ─────
//
// Every case here CORRUPTS the report under a naive scan: the head's <style>
// lands in the editable body, `parseBody` drops it, and the first save writes
// the report back without its content or its CSS. The round-trip stays
// byte-exact throughout, which is exactly why none of the existing tests see
// it — the damage happens on the parse→serialize leg, not the split leg.
describe("splitShell — the head must never reach the editable body", () => {
  const KEEPS_HEAD_OUT: readonly [name: string, html: string][] = [
    [
      "an OMITTED </head> (optional end tag in HTML5)",
      `<!doctype html><html><head><meta charset="utf-8"><title>Q3</title><style>.c{color:#0a0}</style><h1>Q3</h1><p>Body.</p></html>`,
    ],
    [
      "a decoy </head> inside an HTML comment",
      `<html><!-- see </head> --><head><style>p{color:red}</style></head><h1>Title</h1></html>`,
    ],
    [
      "a decoy </head> inside a <style> string (RAWTEXT)",
      `<html><head><style>a::after{content:"</head>"}</style></head><h1>Title</h1></html>`,
    ],
    [
      "a decoy </head> inside an attribute value",
      `<html><head><meta name="x" content="</head>"><style>p{color:red}</style></head><h1>T</h1></html>`,
    ],
  ];

  it.each(KEEPS_HEAD_OUT)("%s keeps <style> in the shell, not the body", (_n, html) => {
    const { shell, bodyHtml } = splitShell(html);

    expect(bodyHtml).not.toContain("<style");
    expect(bodyHtml).not.toContain("<meta");
    expect(shell.pre).toContain("<style");
  });

  it.each(KEEPS_HEAD_OUT)("%s still round-trips byte-identically", (_n, html) => {
    const { shell, bodyHtml } = splitShell(html);
    expect(reinjectShell(shell, bodyHtml)).toBe(html);
  });

  it("keeps the real content in the body when </head> is omitted", () => {
    const { bodyHtml } = splitShell(
      `<!doctype html><html><head><style>.c{color:#0a0}</style><h1>Q3</h1><p>Body.</p></html>`,
    );

    expect(bodyHtml).toContain("<h1>Q3</h1>");
    expect(bodyHtml).toContain("<p>Body.</p>");
  });

  it("does not treat a <body> mentioned inside a comment as the real body", () => {
    // BODY_OPEN_RE is comment-blind, so this used to be reported as a
    // malformed body — copy that tells the operator to fix a tag they never
    // wrote. A report ABOUT html is a realistic instance.
    const { bodyHtml } = splitShell(
      `<html><head></head><h1>Doc</h1><!-- <body> --><p>x</p></html>`,
    );

    expect(bodyHtml).toContain("<h1>Doc</h1>");
  });
});
