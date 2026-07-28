// PATCH  /api/v1/reports/{slug}/comments/{comment_id} — resolve a comment.
// DELETE /api/v1/reports/{slug}/comments/{comment_id} — delete a comment.
// Both are the comment's AUTHOR-OR-the-report's-OWNER (ADR-0064 §3) — a
// DIFFERENT rule from the create/reply `canWrite` gate, enforced inside
// resolveComment/deleteComment (which also load the report via
// loadReadableReport, not loadOrgReport — so a cross-org write-grantee who
// authored a comment can still resolve/delete their own, ADR-0060 §4), not by
// this thin transport layer.
//
// JUDGMENT CALL (flagged per the task brief): ADR-0064 §7 lists "get/update/
// resolve/delete" on this route without pinning verbs. This repo's closest
// precedent is api.v1.reports.$slug.ts (PATCH = mutate a field in place, DELETE
// = remove). PATCH is OVERLOADED on the request-body shape (same way this
// file's sibling reuses POST for both create and reply): a body carrying `body`
// and/or `intent` EDITS those fields (ADR-0064 §3); an empty/absent body is the
// idempotent RESOLVE ("mutate resolved_at" — there is only one resolved
// transition today, no un-resolve). The resolve path is byte-for-byte unchanged
// (its callers send no JSON body, so `parseCommentPatch(undefined)` → resolve).
// Editing is author-or-owner gated (ADR-0064 §3), the SAME rule as resolve/
// delete — NOT the create/reply `canWrite` gate. GET (fetch one comment) and
// editing the anchor are still NOT built — out of scope (the anchor is immutable
// in v1, ADR-0064).
//
// CORS + `loader` (ADR-0063 API slice): this resource only ever had an
// `action` (PATCH/DELETE) — no `loader` at all — so a GET/HEAD/OPTIONS
// request used to 404 (Remix/React-Router: a route with no `loader` export
// throws 404 for any non-mutation method BEFORE even reaching this file's
// code). But an `OPTIONS` preflight is ALWAYS routed to `loader`, never
// `action` (React-Router only sends POST/PUT/PATCH/DELETE to `action`), so
// without a `loader` here a cross-origin preflight would 404 and the
// PATCH/DELETE it's gating would never even be attempted by the browser.
// The added `loader` answers that preflight (via `corsRoute`) and otherwise
// 405s a stray GET — a more correct response than the old 404, and the only
// way to make CORS work on this resource at all.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { deleteComment, editComment, resolveComment } from "arp-application";
import { type AppError, makeCommentId, methodNotAllowed, ok, type Result } from "arp-domain";
import {
  deleteCommentToHttp,
  errorToHttp,
  parseCommentPatch,
  parseJsonBody,
  resolveCommentToHttp,
} from "arp-http";
import { clock, commentRepo, deps } from "../server/container.server";
import { corsRoute } from "../server/cors.server";
import { handle } from "../server/handle.server";
import { toResponse, wireContext } from "../server/http.server";

const ALLOWED_METHODS = "PATCH, DELETE, OPTIONS";

export const loader = corsRoute(ALLOWED_METHODS, async (_args: LoaderFunctionArgs) =>
  toResponse(errorToHttp(methodNotAllowed("PATCH, DELETE"))),
);

export const action = corsRoute(ALLOWED_METHODS, dispatchAction);

async function dispatchAction(args: ActionFunctionArgs) {
  const method = args.request.method.toUpperCase();
  if (method === "PATCH") return patchHandler(args);
  if (method === "DELETE") return deleteHandler(args);

  return toResponse(errorToHttp(methodNotAllowed("PATCH, DELETE")));
}

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

const patchHandler = handle({
  mode: "write",
  slug: true,
  // Both branches (resolve + edit) yield a `Result<Comment>` mapped to a 200
  // comment resource — resolveCommentToHttp is that mapper, reused for edit.
  run: async ({ args, actor, slug }) => {
    const commentId = makeCommentId(String(args.params.comment_id ?? ""));
    if (!commentId.ok) return commentId;

    const parsedBody = await readCommentPatchBody(args.request);
    if (!parsedBody.ok) return parsedBody;
    const patch = parseCommentPatch(parsedBody.value);
    if (!patch.ok) return patch; // 422 on a bad body/intent

    // Spreads deps() (carries `grants`/`identities` for the loadReadableReport
    // gate, ADR-0060 §4) + the comment-specific repo/clock.
    const commentDeps = { ...deps(), comments: commentRepo(), clock: clock() };
    const commentActor = { orgId: actor.orgId, userId: actor.userId };

    if (patch.value.kind === "edit") {
      return editComment(commentDeps, commentActor, {
        slug,
        commentId: commentId.value,
        body: patch.value.body,
        intent: patch.value.intent,
        expectedEditedAt: patch.value.expectedEditedAt,
      });
    }
    return resolveComment(commentDeps, commentActor, { slug, commentId: commentId.value });
  },
  toHttp: (result) => resolveCommentToHttp(result, wireContext()),
});

const deleteHandler = handle({
  mode: "write",
  slug: true,
  run: ({ args, actor, slug }) => {
    const commentId = makeCommentId(String(args.params.comment_id ?? ""));
    if (!commentId.ok) return commentId;
    return deleteComment(
      { ...deps(), comments: commentRepo() },
      { orgId: actor.orgId, userId: actor.userId },
      { slug, commentId: commentId.value },
    );
  },
  toHttp: (result) => deleteCommentToHttp(result),
});
