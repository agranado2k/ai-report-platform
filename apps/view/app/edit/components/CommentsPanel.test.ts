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
  author: { id: "user_5mK9pQ2vR4nXtB6cD8eF1g", email: null, name: null },
  parent_id: null,
  body: "hi",
  intent: "note",
  anchor: { version_pinned: { version_id: "version_1", text_quote: "q" } },
  edited_at: null,
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

  it("falls back to 'Unknown user' when neither name nor email resolves (never the raw id)", () => {
    // The wire ALWAYS carries `author` (resource.ts null-fills it — see the
    // arp-http/wire catalog); a deleted/never-mirrored user arrives as
    // { email: null, name: null }, which `base` models.
    const label = authorLabel(base);
    expect(label).toBe("Unknown user");
    expect(label).not.toContain("user_");
  });
});
