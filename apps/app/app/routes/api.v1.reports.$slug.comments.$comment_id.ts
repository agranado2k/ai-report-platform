// PATCH  /api/v1/reports/{slug}/comments/{comment_id} — resolve OR edit a
// comment (PATCH is overloaded on the request-body shape: an empty/absent body
// is the idempotent RESOLVE; a body carrying `body`/`intent` EDITS those
// fields, ADR-0064 §3).
// DELETE /api/v1/reports/{slug}/comments/{comment_id} — delete a comment.
// All are the comment's AUTHOR-OR-the-report's-OWNER (ADR-0064 §3) — a
// DIFFERENT rule from the create/reply `canWrite` gate, enforced inside
// resolveComment/editComment/deleteComment (which load the report via
// loadReadableReport, not loadOrgReport — so a cross-org write-grantee who
// authored a comment can still act on their own, ADR-0060 §4), not by this
// thin transport layer. Built on the deepened `handle()` seam + `ops()`.
//
// CORS + the 405 `loader` (ADR-0063 API slice): an `OPTIONS` preflight is
// ALWAYS routed to `loader`, never `action` (React-Router only sends
// POST/PUT/PATCH/DELETE to `action`), so this action-only resource still needs
// a `loader` for `corsRoute` to answer the preflight; a stray GET reads as 405.
import { type AppError, makeCommentId, ok, type Result } from "arp-domain";
import {
  deleteCommentToHttp,
  parseCommentPatch,
  parseJsonBody,
  resolveCommentToHttp,
} from "arp-http";
import { ops } from "../server/container.server";
import { corsRoute } from "../server/cors.server";
import { handle, methodNotAllowedLoader, methods } from "../server/handle.server";
import { wireContext } from "../server/http.server";

const ALLOWED_METHODS = "PATCH, DELETE, OPTIONS";

export const loader = corsRoute(ALLOWED_METHODS, methodNotAllowedLoader("PATCH, DELETE"));

// Read the PATCH body WITHOUT `handle`'s `parseBody` (which 415s a bodyless
// request — and the resolve path deliberately sends none): a request with no
// `application/json` content-type carries no edit fields → resolve; a JSON body
// is parsed (malformed → 422) and classified by `parseCommentPatch`.
async function readCommentPatchBody(
  request: Request,
): Promise<Result<Record<string, unknown> | undefined, AppError>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return ok(undefined);
  return parseJsonBody(request);
}

export const action = corsRoute(
  ALLOWED_METHODS,
  methods({
    PATCH: handle({
      mode: "write",
      slug: true,
      // Both branches (resolve + edit) yield a `Result<Comment>` mapped to a 200
      // comment resource — resolveCommentToHttp is that mapper, reused for edit.
      run: async ({ args, actor, slug, idempotencyKey }) => {
        const commentId = makeCommentId(String(args.params.comment_id ?? ""));
        if (!commentId.ok) return commentId;

        const parsedBody = await readCommentPatchBody(args.request);
        if (!parsedBody.ok) return parsedBody;
        const patch = parseCommentPatch(parsedBody.value);
        if (!patch.ok) return patch; // 422 on a bad body/intent

        const commentActor = { orgId: actor.orgId, userId: actor.userId };
        if (patch.value.kind === "edit") {
          return ops().editComment(commentActor, {
            slug,
            commentId: commentId.value,
            body: patch.value.body,
            intent: patch.value.intent,
            expectedEditedAt: patch.value.expectedEditedAt,
            idempotencyKey,
          });
        }
        return ops().resolveComment(commentActor, {
          slug,
          commentId: commentId.value,
          idempotencyKey,
        });
      },
      toHttp: (result) => resolveCommentToHttp(result, wireContext()),
    }),
    DELETE: handle({
      mode: "write",
      slug: true,
      run: ({ args, actor, slug, idempotencyKey }) => {
        const commentId = makeCommentId(String(args.params.comment_id ?? ""));
        if (!commentId.ok) return commentId;
        return ops().deleteComment(
          { orgId: actor.orgId, userId: actor.userId },
          { slug, commentId: commentId.value, idempotencyKey },
        );
      },
      toHttp: (result) => deleteCommentToHttp(result),
    }),
  }),
);
