// Behavior tests for parseCommentIntent — the pure request-body guard extracted
// from the reports.$slug.comments resource route's action (ADR-0064, editor
// comment UI slice). Exercises the SAME decode path the route uses
// (makeCommentId/makeVersionId), not a reimplementation.
import { describe, expect, it } from "vitest";
import { parseCommentIntent } from "./comment-intent.server";

const VALID_VERSION_ID = "version_7KpQ2mX9vR4nB6cD8eF1gH";
const VALID_PARENT_ID = "comment_7KpQ2mX9vR4nB6cD8eF1gH";
const VALID_COMMENT_ID = "comment_7KpQ2mX9vR4nB6cD8eF1gH";

describe("parseCommentIntent", () => {
  it("rejects a non-object body", () => {
    const result = parseCommentIntent("not an object");
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown intent", () => {
    const result = parseCommentIntent({ intent: "wat" });
    expect(result.ok).toBe(false);
  });

  describe("intent: add", () => {
    it("parses a valid add request", () => {
      const result = parseCommentIntent({
        intent: "add",
        body: "left a note here",
        anchor: {
          versionId: VALID_VERSION_ID,
          textQuote: "quoted text",
          relative: { from: 1, to: 5 },
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toMatchObject({
        intent: "add",
        body: "left a note here",
        anchor: {
          versionPinned: { textQuote: "quoted text" },
          relative: { from: 1, to: 5 },
        },
      });
    });

    it("omits relative when the anchor carries none", () => {
      const result = parseCommentIntent({
        intent: "add",
        body: "note",
        anchor: { versionId: VALID_VERSION_ID, textQuote: "quoted" },
      });
      expect(result.ok).toBe(true);
      if (!result.ok || result.value.intent !== "add") return;
      expect("relative" in result.value.anchor).toBe(false);
    });

    it("rejects a malformed version id", () => {
      const result = parseCommentIntent({
        intent: "add",
        body: "note",
        anchor: { versionId: "not-a-real-id", textQuote: "quoted" },
      });
      expect(result.ok).toBe(false);
    });

    it("rejects a missing anchor", () => {
      const result = parseCommentIntent({ intent: "add", body: "note" });
      expect(result.ok).toBe(false);
    });
  });

  describe("intent: reply", () => {
    it("parses a valid reply request", () => {
      const result = parseCommentIntent({
        intent: "reply",
        parentCommentId: VALID_PARENT_ID,
        body: "a reply",
        anchor: { versionId: VALID_VERSION_ID, textQuote: "quoted" },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.intent).toBe("reply");
      if (result.value.intent !== "reply") return;
      expect(result.value.parentCommentId).toBeTruthy();
    });

    it("rejects a malformed parent comment id", () => {
      const result = parseCommentIntent({
        intent: "reply",
        parentCommentId: "not-a-real-id",
        body: "a reply",
        anchor: { versionId: VALID_VERSION_ID, textQuote: "quoted" },
      });
      expect(result.ok).toBe(false);
    });
  });

  describe("intent: resolve", () => {
    it("parses a valid resolve request", () => {
      const result = parseCommentIntent({ intent: "resolve", commentId: VALID_COMMENT_ID });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.intent).toBe("resolve");
    });

    it("rejects a missing comment id", () => {
      const result = parseCommentIntent({ intent: "resolve" });
      expect(result.ok).toBe(false);
    });

    it("rejects a malformed comment id", () => {
      const result = parseCommentIntent({ intent: "resolve", commentId: "nope" });
      expect(result.ok).toBe(false);
    });
  });
});
