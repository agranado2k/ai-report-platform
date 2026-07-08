import { describe, expect, it } from "vitest";
import { commentId } from "./brand";
import { commentIdToWire, makeCommentId } from "./comment-id";

describe("makeCommentId / commentIdToWire", () => {
  const uuid = "019ed70f-491d-707a-a263-4c31243f0c9f";

  it("round-trips a comment id through the wire codec", () => {
    const wire = commentIdToWire(commentId(uuid));
    expect(wire.startsWith("comment_")).toBe(true);
    const back = makeCommentId(wire);
    expect(back.ok && back.value).toBe(uuid);
  });

  it("rejects a bare UUID and a differently-prefixed id", () => {
    expect(makeCommentId(uuid).ok).toBe(false);
    expect(makeCommentId(`report_${"a".repeat(22)}`).ok).toBe(false);
  });
});
