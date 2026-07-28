// authorLabel (ADR-0063 author display): prefer the display name, else the
// resolved email, else a stable label — never the raw user_… id.
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
  it("prefers the display name when present", () => {
    expect(
      authorLabel({
        ...base,
        author: { id: base.author_id, email: "alice@example.com", name: "Alice Ackerman" },
      }),
    ).toBe("Alice Ackerman");
  });

  it("shows the author's email when no display name is present", () => {
    expect(
      authorLabel({
        ...base,
        author: { id: base.author_id, email: "alice@example.com", name: null },
      }),
    ).toBe("alice@example.com");
  });

  it("shows the email when the name field is omitted entirely (pre-display-name server)", () => {
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
