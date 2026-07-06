import { describe, expect, it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { computeDiff } from "@platejs/diff";
import { createSlateEditor } from "platejs";
import { serializeHtml } from "platejs/static";
import { l0Plugins } from "../src/editors/l0";
import { DiffPlugin } from "../src/editors/diff-plugin";

describe("Test D — visual diff (@platejs/diff)", () => {
  it("computes an insert/delete diff between original and a 2-paragraph edit, and renders it", async () => {
    const plugins = [...l0Plugins(), DiffPlugin];
    const editor = createSlateEditor({ plugins });

    const original = [
      {
        type: "p",
        children: [
          {
            text:
              "In the AI age the CTO is judged on three calls per year: which model family, which agentic patterns, and build-vs-buy-vs-fine-tune.",
          },
        ],
      },
      {
        type: "p",
        children: [
          {
            text:
              "Designs LLM systems as distributed systems where the model is the planner/executor.",
          },
        ],
      },
      {
        type: "p",
        children: [{ text: "Owns the eval set, not just the spec." }],
      },
    ];

    // Modified copy: 2 of the 3 paragraphs' text changed, one left untouched.
    const modified = [
      {
        type: "p",
        children: [
          {
            text:
              "In the AI age the CTO is judged on three bets per year: which model vendor, which agentic patterns, and build-vs-buy-vs-partner.",
          },
        ],
      },
      {
        type: "p",
        children: [
          {
            text:
              "Designs LLM systems as distributed systems where the model is the planner/executor.",
          },
        ],
      },
      {
        type: "p",
        children: [{ text: "Owns the eval set AND the error-analysis ritual." }],
      },
    ];

    const diffValue = computeDiff(original as any, modified as any, {
      isInline: (node: any) => editor.api.isInline(node),
    });

    // Sanity: the diff actually found changes (not a no-op).
    const flatText = JSON.stringify(diffValue);
    expect(flatText).toContain('"diff":true');
    expect(flatText).toContain('"type":"insert"');
    expect(flatText).toContain('"type":"delete"');

    const diffEditor = createSlateEditor({ plugins, value: diffValue as any });
    const html = await serializeHtml(diffEditor);

    console.log("DIFF HTML:", html);

    expect(html).toContain("<ins");
    expect(html).toContain("<del");

    const outDir = resolve(process.cwd(), "out");
    mkdirSync(outDir, { recursive: true });
    const page = `<!doctype html>
<html><head><meta charset="utf-8"><title>Test D — diff render</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 44rem; margin: 2rem auto; line-height: 1.6; }
  ins.diff-insert { background: #d4f8d4; text-decoration: none; color: #14532d; }
  del.diff-delete { background: #fde2e2; color: #7f1d1d; }
  mark.diff-update { background: #fef3c7; }
</style>
</head><body>
<h1>Test D — Plate diff render (computeDiff + custom decoration plugin)</h1>
${html}
</body></html>`;
    writeFileSync(resolve(outDir, "diff.html"), page, "utf-8");
  });
});
