import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { probeEditability } from "./editability.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(path.resolve(__dirname, "fixtures/ai-readiness-report.html"), "utf-8");

describe("probeEditability", () => {
  it("says a real report document is editable", () => {
    expect(probeEditability(FIXTURE)).toBe("editable");
  });

  it("says a bare fragment with no <body> is unsplittable", () => {
    // The exact shape an agent uploads by accident, and the shape that views
    // fine and cannot be edited (ADR-0080's motivating case).
    expect(probeEditability("<h1>Just a fragment</h1><p>no body tag</p>")).toBe("unsplittable");
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
    expect(probeEditability("<h1>fragment</h1>", true)).toBe("unsplittable");
  });

  it("reports the shell failure FIRST when a document fails both legs", () => {
    // Ordering matters: it mirrors the editor's own call order, so the recorded
    // reason names the step that would actually stop it.
    const deep = "<div>".repeat(5000) + "x" + "</div>".repeat(5000);
    expect(probeEditability(deep)).toBe("unsplittable");
  });

  it("never mutates or re-emits the input — it only answers a question", () => {
    const before = FIXTURE;
    probeEditability(FIXTURE);
    expect(FIXTURE).toBe(before);
  });
});
