// GET  /api/v1/reports/{slug}/comments — list a report's comments (cursor-
// paginated, ADR-0064 §7). Auth is IDENTICAL to GET /api/v1/reports/{slug}/
// versions — the shared org-scoped loadOrgReport guard (ADR-0059 §3). Comments
// never surface on the public viewer (ADR-0064 §4) — this route only exists on
// the app origin.
// POST /api/v1/reports/{slug}/comments — create a root comment, OR (when the
// body carries `parent_comment_id`) reply to one. Both are `canWrite`-gated
// (ADR-0064 §3) via addComment/replyToComment. A reply IS a comment resource on
// the wire (201), just with `parent_id` set.
// Thin transport adapter (ADR-0038) built from the `handle()` combinator.
import { addComment, listComments, replyToComment } from "arp-application";
import {
  type Anchor,
  type AppError,
  err,
  makeCommentId,
  makeVersionId,
  ok,
  type Result,
  validationError,
} from "arp-domain";
import { addCommentToHttp, listCommentsToHttp, parseCursorParams } from "arp-http";
import { clock, commentRepo, deps } from "../server/container.server";
import { handle } from "../server/handle.server";
import { wireContext } from "../server/http.server";

/** Decode the wire anchor shape (resource.ts's commentBody, mirrored on input):
 *  `{ version_pinned: { version_id, text_quote }, relative? }`. `relative` is
 *  passed through opaquely (ADR-0064 §2a — the editor slice doesn't exist yet,
 *  so nothing here interprets it). */
function parseAnchor(raw: unknown): Result<Anchor, AppError> {
  if (typeof raw !== "object" || raw === null) {
    return err(validationError("anchor is required", "anchor"));
  }
  const r = raw as Record<string, unknown>;
  const versionPinned = r.version_pinned;
  if (typeof versionPinned !== "object" || versionPinned === null) {
    return err(validationError("anchor.version_pinned is required", "anchor"));
  }
  const vp = versionPinned as Record<string, unknown>;
  const versionIdRaw = typeof vp.version_id === "string" ? vp.version_id : "";
  const decodedVersionId = makeVersionId(versionIdRaw);
  if (!decodedVersionId.ok) return decodedVersionId;
  const textQuote = typeof vp.text_quote === "string" ? vp.text_quote : "";
  return ok({
    versionPinned: { versionId: decodedVersionId.value, textQuote },
    ...(r.relative !== undefined ? { relative: r.relative } : {}),
  });
}

export const loader = handle({
  mode: "read",
  slug: true,
  run: ({ args, actor, slug }) => {
    const url = new URL(args.request.url);
    const cursor = parseCursorParams(url.searchParams, makeCommentId);
    if (!cursor.ok) return cursor; // malformed cursor → 422

    return listComments(
      { reports: deps().reports, comments: commentRepo() },
      { orgId: actor.orgId },
      { slug, ...cursor.value },
    );
  },
  toHttp: (result) => listCommentsToHttp(result, wireContext()),
});

export const action = handle({
  mode: "write",
  slug: true,
  parseBody: true,
  run: ({ actor, slug, body }) => {
    const anchor = parseAnchor(body.anchor);
    if (!anchor.ok) return anchor;
    const commentBody = typeof body.body === "string" ? body.body : "";

    // Spreads deps() (already carries `grants`/`identities` for the canWrite
    // seam, ADR-0060 §4) + the comment-specific repo/clock.
    const commentDeps = {
      ...deps(),
      comments: commentRepo(),
      clock: clock(),
    };
    const commentActor = { orgId: actor.orgId, userId: actor.userId };

    const parentRaw = body.parent_comment_id;
    if (typeof parentRaw === "string") {
      const parentCommentId = makeCommentId(parentRaw);
      if (!parentCommentId.ok) return parentCommentId;
      return replyToComment(commentDeps, commentActor, {
        slug,
        parentCommentId: parentCommentId.value,
        body: commentBody,
        anchor: anchor.value,
      });
    }

    return addComment(commentDeps, commentActor, { slug, body: commentBody, anchor: anchor.value });
  },
  toHttp: (result) => addCommentToHttp(result, wireContext()),
});
