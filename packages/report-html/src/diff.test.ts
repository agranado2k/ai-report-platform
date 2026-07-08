// diffDocs / diffRendered (ADR-0065 §3) — the structural, word-level visual
// diff over two ProseMirror doc JSONs. Mechanism: a whole-body Transform fed
// to prosemirror-changeset (spike-proven, spike/DECISION.md via PR #144),
// simplified to word boundaries. Deletions have no position in the new doc,
// so they render as a widget-style annotation immediately before the
// corresponding insertion point — an accepted ADR-0065 limitation, not a bug.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBody } from "./body.js";
import { diffDocs, diffRendered } from "./diff.js";
import { DIFF_DEL_CLASS, DIFF_INS_CLASS } from "./diff-schema.js";
import { splitShell } from "./shell.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, "./fixtures/ai-readiness-report.html");
const loadFixtureHtml = () => readFileSync(FIXTURE_PATH, "utf-8");

describe("diffDocs", () => {
  it("finds a word-level change range for a single word swap", () => {
    const oldDoc = parseBody('<p class="desc">The quick brown fox jumps over the lazy dog.</p>');
    const newDoc = parseBody('<p class="desc">The quick brown fox leaps over the lazy dog.</p>');

    const { changes } = diffDocs(oldDoc, newDoc);

    expect(changes.length).toBe(1);
    expect(changes[0]?.deletedText).toBe("jumps");
    expect(changes[0]?.insertedText).toBe("leaps");
  });

  it("finds a pure insertion (no deleted text) as its own range", () => {
    const oldDoc = parseBody("<p>one two three</p>");
    const newDoc = parseBody("<p>one two three four</p>");

    const { changes } = diffDocs(oldDoc, newDoc);

    expect(changes.length).toBe(1);
    expect(changes[0]?.deletedText).toBe("");
    expect(changes[0]?.insertedText).toBe(" four");
  });

  it("finds a pure deletion (no inserted text) as its own range", () => {
    const oldDoc = parseBody("<p>one two three four five</p>");
    const newDoc = parseBody("<p>one two five</p>");

    const { changes } = diffDocs(oldDoc, newDoc);

    expect(changes.length).toBe(1);
    expect(changes[0]?.deletedText).toBe("three four ");
    expect(changes[0]?.insertedText).toBe("");
  });

  it("property: an unchanged doc produces no change ranges", () => {
    const doc = parseBody(
      '<p class="desc">Nothing about this paragraph changes between the two versions.</p>',
    );
    const { changes } = diffDocs(doc, doc);
    expect(changes).toEqual([]);
  });

  it("property: two independently-parsed but textually-identical docs still produce no changes", () => {
    const html = "<p>Same content, parsed twice into two separate doc trees.</p>";
    const { changes } = diffDocs(parseBody(html), parseBody(html));
    expect(changes).toEqual([]);
  });

  it("finds a change against the real fixture (one edited .desc paragraph)", () => {
    // parseBody takes BODY html, not a whole document — split the shell first,
    // exactly as the app does (reports.$slug.diff.tsx / .edit.tsx).
    const { bodyHtml } = splitShell(loadFixtureHtml());
    const oldDoc = parseBody(bodyHtml);
    const edited = bodyHtml.replace(
      "Tokenization, attention, KV cache, sampling, context-window economics, why fine-tunes drift.",
      "Tokenization and context-window economics now ship with hosted debugging tools.",
    );
    const newDoc = parseBody(edited);

    const { changes } = diffDocs(oldDoc, newDoc);

    expect(changes.length).toBeGreaterThan(0);
    const deletedJoined = changes.map((c) => c.deletedText).join(" ");
    const insertedJoined = changes.map((c) => c.insertedText).join(" ");
    // "Tokenization" and "context-window economics" are the common prefix/
    // infix shared by both versions, so a correct word-level diff should
    // NOT flag them as changed — only the genuinely differing text either
    // side is unique to.
    expect(deletedJoined).toContain("attention, KV cache");
    expect(insertedJoined).toContain("hosted debugging tools");
  });
});

describe("diffRendered", () => {
  it("renders insert/delete markers as classes, not bare tags", () => {
    const oldDoc = parseBody('<p class="desc">The quick brown fox jumps over the lazy dog.</p>');
    const newDoc = parseBody('<p class="desc">The quick brown fox leaps over the lazy dog.</p>');

    const html = diffRendered(oldDoc, newDoc);

    expect(html).toContain(`class="${DIFF_INS_CLASS}"`);
    expect(html).toContain(`class="${DIFF_DEL_CLASS}"`);
    expect(html).not.toMatch(/<ins[\s>]/);
    expect(html).not.toMatch(/<del[\s>]/);
    expect(html).toContain("leaps");
    expect(html).toContain("jumps"); // deleted text preserved via the widget annotation
  });

  it("property: an unchanged doc renders with no diff markers at all", () => {
    const doc = parseBody('<p class="desc">Nothing changes here between the two versions.</p>');
    const html = diffRendered(doc, doc);
    expect(html).not.toContain(DIFF_INS_CLASS);
    expect(html).not.toContain(DIFF_DEL_CLASS);
  });

  it("renders a pure deletion as a widget-style annotation (accepted ADR-0065 limitation)", () => {
    const oldDoc = parseBody("<p>one two three four five</p>");
    const newDoc = parseBody("<p>one two five</p>");

    const html = diffRendered(oldDoc, newDoc);

    expect(html).toContain(`class="${DIFF_DEL_CLASS}"`);
    expect(html).toContain("three four");
    expect(html).not.toContain(DIFF_INS_CLASS);
  });

  it("renders cleanly against the real fixture end to end", () => {
    const { bodyHtml } = splitShell(loadFixtureHtml());
    const oldDoc = parseBody(bodyHtml);
    const edited = bodyHtml.replace(
      "Tokenization, attention, KV cache, sampling, context-window economics, why fine-tunes drift.",
      "Tokenization and context-window economics now ship with hosted debugging tools.",
    );
    const newDoc = parseBody(edited);

    const html = diffRendered(oldDoc, newDoc);

    expect(html).toContain(DIFF_INS_CLASS);
    expect(html).toContain(DIFF_DEL_CLASS);
    expect(html).toContain("hosted debugging tools");
  });
});
