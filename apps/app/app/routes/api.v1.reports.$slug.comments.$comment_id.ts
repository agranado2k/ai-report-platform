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
import { deleteComment, resolveComment } from "arp-application";
import { makeCommentId, methodNotAllowed } from "arp-domain";
import { deleteCommentToHttp, errorToHttp, resolveCommentToHttp } from "arp-http";
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
