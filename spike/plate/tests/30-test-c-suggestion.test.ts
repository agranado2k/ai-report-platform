import { describe, expect, it } from "vitest";
import { createSlateEditor } from "platejs";
import { serializeHtml } from "platejs/static";
import { BaseSuggestionPlugin } from "@platejs/suggestion";
import { acceptSuggestion, rejectSuggestion } from "@platejs/suggestion";
import { JSDOM } from "jsdom";
import { loadFixtureBody } from "../src/lib/fixtures";
import { l0Plugins } from "../src/editors/l0";

// Real .desc paragraph lifted straight from the fixture (Pillar A intro).
function findRealDescText(): string {
  const dom = new JSDOM(`<body>${loadFixtureBody()}</body>`);
  const el = dom.window.document.querySelector(".desc");
  return (el?.textContent ?? "").trim();
}

const CANNED_REWRITE =
  "What the model and the system actually do — rewritten by a canned test stub, not an LLM.";

function buildEditorWithPendingSuggestion(originalText: string, suggestionId: string) {
  const suggestionPlugin = BaseSuggestionPlugin.configure({
    options: { currentUserId: "test-user" },
  });

  const now = Date.now();
  const removeData = {
    id: suggestionId,
    createdAt: now,
    type: "remove",
    userId: "test-user",
  };
  const insertData = {
    id: suggestionId,
    createdAt: now,
    type: "insert",
    userId: "test-user",
  };

  const value = [
    {
      type: "p",
      children: [
        {
          text: originalText,
          suggestion: true,
          [`suggestion_${suggestionId}`]: removeData,
        },
        {
          text: CANNED_REWRITE,
          suggestion: true,
          [`suggestion_${suggestionId}`]: insertData,
        },
      ],
    },
  ];

  return createSlateEditor({
    plugins: [...l0Plugins(), suggestionPlugin],
    value,
  });
}

describe("Test C — suggestion accept/reject smoke test", () => {
  const originalText = findRealDescText();

  it("has a real .desc paragraph to work with", () => {
    expect(originalText.length).toBeGreaterThan(10);
  });

  it("ACCEPT: exported HTML contains the canned rewrite, not the original text", async () => {
    const editor = buildEditorWithPendingSuggestion(originalText, "sugg-1");

    acceptSuggestion(editor, {
      keyId: "suggestion_sugg-1",
      suggestionId: "sugg-1",
    } as any);

    const output = await serializeHtml(editor);
    console.log("ACCEPT output:", output);

    expect(output).toContain(CANNED_REWRITE);
    expect(output).not.toContain(originalText);
  });

  it("REJECT: exported HTML is unchanged (original text, no canned rewrite)", async () => {
    const editor = buildEditorWithPendingSuggestion(originalText, "sugg-2");

    rejectSuggestion(editor, {
      keyId: "suggestion_sugg-2",
      suggestionId: "sugg-2",
    } as any);

    const output = await serializeHtml(editor);
    console.log("REJECT output:", output);

    expect(output).toContain(originalText);
    expect(output).not.toContain(CANNED_REWRITE);
  });
});
