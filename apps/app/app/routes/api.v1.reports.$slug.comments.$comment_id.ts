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
// = remove) — resolving is exactly that shape ("mutate resolved_at"), so PATCH
// carries it (idempotent; the body is ignored — there is only one resolved
// transition today, no un-resolve). GET (fetch one comment) and general
// field-editing PATCH (body/anchor) are NOT built — out of scope for this
// slice; only resolve+delete were requested. A future edit-comment PATCH could
// reuse this same route by inspecting the body shape, same as this file's
// sibling reuses POST for both create and reply.
import type { ActionFunctionArgs } from "@remix-run/node";
import { deleteComment, resolveComment } from "arp-application";
import { makeCommentId, methodNotAllowed } from "arp-domain";
import { deleteCommentToHttp, errorToHttp, resolveCommentToHttp } from "arp-http";
import { clock, commentRepo, deps } from "../server/container.server";
import { handle } from "../server/handle.server";
import { toResponse, wireContext } from "../server/http.server";

export async function action(args: ActionFunctionArgs) {
  const method = args.request.method.toUpperCase();
  if (method === "PATCH") return patchHandler(args);
  if (method === "DELETE") return deleteHandler(args);

  return toResponse(errorToHttp(methodNotAllowed("PATCH, DELETE")));
}

const patchHandler = handle({
  mode: "write",
  slug: true,
  run: ({ args, actor, slug }) => {
    const commentId = makeCommentId(String(args.params.comment_id ?? ""));
    if (!commentId.ok) return commentId;
    // Spreads deps() (carries `grants`/`identities` for the loadReadableReport
    // gate, ADR-0060 §4) + the comment-specific repo/clock.
    return resolveComment(
      { ...deps(), comments: commentRepo(), clock: clock() },
      { orgId: actor.orgId, userId: actor.userId },
      { slug, commentId: commentId.value },
    );
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
