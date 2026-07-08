// POST /reports/{slug}/comments — the dashboard-origin resource route the
// editor's comment sidebar (reports.$slug.edit.tsx) posts to via fetcher. A
// thin Remix wrapper over the SAME addComment/replyToComment/resolveComment
// use cases the /api/v1/reports/{slug}/comments[/{comment_id}] routes call —
// no new authorization rule, no new domain behavior (ADR-0064 §3: canWrite
// gates add/reply; author-or-owner gates resolve, enforced INSIDE the use
// cases, not here).
//
// This is a resource route (no default export) — action only, mirroring how
// reports.$slug.edit.tsx's own action already POSTs JSON to save an edit.
// One `intent` field (add | reply | resolve) discriminates, same pattern
// settings.api-keys.tsx uses for create/revoke — except here the payload is a
// JSON body (structured anchor data), not FormData, consistent with the edit
// route's own save action.
//
// JUDGMENT CALL: `deleteComment` is NOT wired here. The task brief's sidebar
// scope is explicitly "add (on selection), reply (single level), resolve" —
// no delete/moderation UI in this slice. The use case and its /api/v1 route
// already exist for a future moderation surface; this route deliberately
// stays narrower.
import { type ActionFunctionArgs, json } from "@remix-run/node";
import { addComment, replyToComment, resolveComment } from "arp-application";
import { makeSlug } from "arp-domain";
import { resolveUploadActor } from "../server/auth.server";
import { commentToDto } from "../server/comment-dto.server";
import { parseCommentIntent } from "../server/comment-intent.server";
import { clock, commentRepo, deps } from "../server/container.server";
import { errorToJson, rejectNonJsonContentType } from "../server/http.server";

export async function action(args: ActionFunctionArgs) {
  if (args.request.method !== "POST") {
    return errorToJson({ kind: "MethodNotAllowed", message: "POST only", allow: "POST" });
  }

  // SECURITY: same JSON-only guard as the edit route's save action (PR #151
  // review, Fix 4) — see rejectNonJsonContentType's doc comment for why.
  const contentTypeRejection = rejectNonJsonContentType(args.request);
  if (contentTypeRejection) return contentTypeRejection;

  const actor = await resolveUploadActor(args);
  if (!actor.ok) return errorToJson(actor.error);

  const slugR = makeSlug(String(args.params.slug ?? ""));
  if (!slugR.ok) return errorToJson(slugR.error);

  let raw: unknown;
  try {
    raw = await args.request.json();
  } catch {
    return errorToJson({ kind: "ValidationError", message: "malformed JSON body" });
  }

  const parsed = parseCommentIntent(raw);
  if (!parsed.ok) return errorToJson(parsed.error);
  const input = parsed.value;

  // Spreads deps() (already carries `grants`/`identities` for the canWrite /
  // loadReadableReport seams, ADR-0060 §4) + the comment-specific repo/clock.
  const commentDeps = { ...deps(), comments: commentRepo(), clock: clock() };
  const commentActor = { orgId: actor.value.orgId, userId: actor.value.userId };

  if (input.intent === "add") {
    const result = await addComment(commentDeps, commentActor, {
      slug: slugR.value,
      body: input.body,
      anchor: input.anchor,
    });
    if (!result.ok) return errorToJson(result.error);
    return json({ ok: true as const, comment: commentToDto(result.value) });
  }

  if (input.intent === "reply") {
    const result = await replyToComment(commentDeps, commentActor, {
      slug: slugR.value,
      parentCommentId: input.parentCommentId,
      body: input.body,
      anchor: input.anchor,
    });
    if (!result.ok) return errorToJson(result.error);
    return json({ ok: true as const, comment: commentToDto(result.value) });
  }

  const result = await resolveComment(commentDeps, commentActor, {
    slug: slugR.value,
    commentId: input.commentId,
  });
  if (!result.ok) return errorToJson(result.error);
  return json({ ok: true as const, comment: commentToDto(result.value) });
}

// No `loader` export here on purpose: the sidebar's comment LIST comes from
// reports.$slug.edit.tsx's own loader (server-side listComments call), per
// the task brief's "not a client HTTP self-call" instruction — this route is
// action-only (mutations), and Remix automatically revalidates the edit
// route's loader after any fetcher action resolves, refreshing the list.
