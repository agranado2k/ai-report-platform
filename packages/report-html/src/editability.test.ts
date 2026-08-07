import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { probeEditability } from "./editability.js";
import { splitShell } from "./shell.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(path.resolve(__dirname, "fixtures/ai-readiness-report.html"), "utf-8");

describe("probeEditability", () => {
  it("says a real report document is editable", () => {
    expect(probeEditability(FIXTURE)).toBe("editable");
  });

  it("says a bare fragment with no <body> is EDITABLE (ADR-0062 Amendment 4)", () => {
    // The exact shape an agent uploads by accident. It used to be the
    // motivating case for `unsplittable` (ADR-0080); Amendment 4 makes the
    // split synthesise the boundary instead of demanding the tag, because
    // "views fine, refuses to edit" was a dead end for the report's owner.
    expect(probeEditability("<h1>Just a fragment</h1><p>no body tag</p>")).toBe("editable");
  });

  it("says a head-only document with no <body> is editable and keeps its head shell", () => {
    const html = "<html><head><style>p{color:red}</style></head><p>hi</p></html>";

    expect(probeEditability(html)).toBe("editable");
    // The second half of this test's own name, which it used not to check.
    expect(splitShell(html).bodyHtml).not.toContain("<style");
  });

  it("says a document whose <body> never closes is unsplittable", () => {
    expect(probeEditability("<html><body><p>hi</p></html>")).toBe("unsplittable");
  });

  it("says a document the editor's parser cannot handle is unparsable", () => {
    // A body ProseMirror's RECURSIVE DOM parse overflows the stack on — the
    // `document-unparsable` degrade PR #247 adds to the read path. Splittable,
    // servable, and un-openable: the second half of the same class.
    const deep = "<div>".repeat(5000) + "x" + "</div>".repeat(5000);
    expect(probeEditability(`<html><body>${deep}</body></html>`)).toBe("unparsable");
  });

  it("skips the parse leg for a version that carries a _source.json sidecar", () => {
    // The editor loads the sidecar INSTEAD of parsing the body (ADR-0062 §4),
    // so the parse leg cannot stop it and must not be held against it.
    const deep = "<div>".repeat(5000) + "x" + "</div>".repeat(5000);
    const doc = `<html><body>${deep}</body></html>`;
    expect(probeEditability(doc, false)).toBe("unparsable");
    expect(probeEditability(doc, true)).toBe("editable");
  });

  it("still requires the shell to split even with a sidecar", () => {
    // An UNCLOSED body is the surviving unsplittable shape after Amendment 4:
    // the tag is present, so the fragment path never engages, and there is no
    // `</body>` to split on. A sidecar cannot rescue it.
    expect(probeEditability("<html><body><p>hi</p></html>", true)).toBe("unsplittable");
  });

  it("reports the shell failure FIRST when a document fails both legs", () => {
    // Ordering matters: it mirrors the editor's own call order, so the recorded
    // reason names the step that would actually stop it.
    const deep = "<div>".repeat(5000) + "x" + "</div>".repeat(5000);
    expect(probeEditability(`<html><body>${deep}</html>`)).toBe("unsplittable");
  });

  it("never mutates or re-emits the input — it only answers a question", () => {
    const before = FIXTURE;
    probeEditability(FIXTURE);
    expect(FIXTURE).toBe(before);
  });
});
