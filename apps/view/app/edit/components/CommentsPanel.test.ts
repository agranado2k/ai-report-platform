// authorLabel (ADR-0063 author display): render the resolved email, falling
// back to a stable label — never the raw user_… id — when identity is absent.
import { describe, expect, it } from "vitest";
import type { CommentWire } from "../wire-types";
import { authorLabel } from "./CommentsPanel";

const base: CommentWire = {
  object: "comment",
  id: "comment_1",
  report_id: "report_1",
  author_id: "user_5mK9pQ2vR4nXtB6cD8eF1g",
  parent_id: null,
  body: "hi",
  intent: "note",
  anchor: { version_pinned: { version_id: "version_1", text_quote: "q" } },
  resolved_at: null,
  created_at: "2026-07-08T00:00:00.000Z",
  mode: "prod",
};

describe("authorLabel", () => {
  it("shows the author's email when resolved", () => {
    expect(
      authorLabel({ ...base, author: { id: base.author_id, email: "alice@example.com" } }),
    ).toBe("alice@example.com");
  });

  it("falls back to 'Unknown user' when the email is null", () => {
    expect(authorLabel({ ...base, author: { id: base.author_id, email: null } })).toBe(
      "Unknown user",
    );
  });

  it("falls back to 'Unknown user' when the author field is absent (never the raw id)", () => {
    const label = authorLabel(base);
    expect(label).toBe("Unknown user");
    expect(label).not.toContain("user_");
  });
});
