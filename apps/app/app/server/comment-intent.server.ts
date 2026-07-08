// Pure request-body guard for the reports.$slug.comments resource route
// (ADR-0064, editor comment UI slice). Extracted from the action so the
// parsing/validation is unit-testable without a Request object — mirrors the
// carve-out reasoning http.server.ts/handle.server.ts already established for
// this app's transport-seam helpers. Decodes the SAME External Id wire form
// (comment_…/version_…, ADR-0052) the /api/v1 comments route uses, via the
// same makeCommentId/makeVersionId smart constructors — not a reimplementation.
//
// This route's wire shape is camelCase (versionId/textQuote/parentCommentId),
// deliberately NOT the /api/v1 route's snake_case (ADR-0053 only binds the
// public API surface; this is an internal, same-origin Remix resource route).
import {
  type Anchor,
  type AppError,
  type CommentId,
  err,
  makeCommentId,
  makeVersionId,
  ok,
  type Result,
  validationError,
} from "arp-domain";

export type CommentIntentRequest =
  | { readonly intent: "add"; readonly body: string; readonly anchor: Anchor }
  | {
      readonly intent: "reply";
      readonly parentCommentId: CommentId;
      readonly body: string;
      readonly anchor: Anchor;
    }
  | { readonly intent: "resolve"; readonly commentId: CommentId };

function parseRelative(raw: unknown): { from: number; to: number } | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.from === "number" && typeof r.to === "number") return { from: r.from, to: r.to };
  return undefined;
}

function parseAnchor(raw: unknown): Result<Anchor, AppError> {
  if (typeof raw !== "object" || raw === null) {
    return err(validationError("anchor is required", "anchor"));
  }
  const r = raw as Record<string, unknown>;
  const versionIdRaw = typeof r.versionId === "string" ? r.versionId : "";
  const decodedVersionId = makeVersionId(versionIdRaw);
  if (!decodedVersionId.ok) return decodedVersionId;
  const textQuote = typeof r.textQuote === "string" ? r.textQuote : "";
  const relative = parseRelative(r.relative);
  return ok({
    versionPinned: { versionId: decodedVersionId.value, textQuote },
    ...(relative ? { relative } : {}),
  });
}

/** Parse+validate an unknown JSON body into one of the four comment mutations
 *  the resource route supports. Unknown/missing `intent` → ValidationError
 *  (422 once mapped by errorToJson). */
export function parseCommentIntent(raw: unknown): Result<CommentIntentRequest, AppError> {
  if (typeof raw !== "object" || raw === null) {
    return err(validationError("malformed request body"));
  }
  const r = raw as Record<string, unknown>;
  const intent = typeof r.intent === "string" ? r.intent : "";

  if (intent === "add") {
    const anchor = parseAnchor(r.anchor);
    if (!anchor.ok) return anchor;
    return ok({
      intent: "add",
      body: typeof r.body === "string" ? r.body : "",
      anchor: anchor.value,
    });
  }

  if (intent === "reply") {
    const parentCommentId = makeCommentId(
      typeof r.parentCommentId === "string" ? r.parentCommentId : "",
    );
    if (!parentCommentId.ok) return parentCommentId;
    const anchor = parseAnchor(r.anchor);
    if (!anchor.ok) return anchor;
    return ok({
      intent: "reply",
      parentCommentId: parentCommentId.value,
      body: typeof r.body === "string" ? r.body : "",
      anchor: anchor.value,
    });
  }

  if (intent === "resolve") {
    const commentId = makeCommentId(typeof r.commentId === "string" ? r.commentId : "");
    if (!commentId.ok) return commentId;
    return ok({ intent: "resolve", commentId: commentId.value });
  }

  return err(validationError(`unknown intent: ${intent}`, "intent"));
}
