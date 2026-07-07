// CommentId smart constructor + wire codec (ADR-0052, ADR-0064). `commentId()` in
// brand.ts is a bare cast for a trusted internal value; `makeCommentId` decodes +
// validates an untrusted `comment_…` into the internal uuid; `commentIdToWire`
// encodes for output.
import type { CommentId } from "./brand";
import { commentId } from "./brand";
import type { AppError } from "./errors";
import { decodeExternalId, encodeExternalId } from "./external-id";
import { ok, type Result } from "./result";

const PREFIX = "comment";

export const makeCommentId = (raw: string): Result<CommentId, AppError> => {
  const decoded = decodeExternalId(PREFIX, raw, "commentId");
  if (!decoded.ok) return decoded;
  return ok(commentId(decoded.value));
};

export const commentIdToWire = (id: CommentId): string => encodeExternalId(PREFIX, id);
