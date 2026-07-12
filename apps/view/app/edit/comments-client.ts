// Cross-origin comment read/write helpers for the in-viewer editor's
// Comments tab (unified-experience epic, ADR-0064 §7 / ADR-0063's edit-token
// API acceptance seam). Same pattern as ../edit/save-edit.ts (Bearer-only,
// `credentials: "omit"` — the edit token IS the credential, never a cookie;
// see save-edit.ts's header comment for the full CORS/CSRF rationale, which
// applies identically here).
//
// `listComments` is called from BOTH sides of the origin boundary: the
// `/<slug>/edit` route's LOADER (server-to-server, no CORS involved — see
// the route file) for the initial list, and the CLIENT (browser fetch, CORS
// via the #183 acceptance seam) to refresh the list after a mutation. The
// write helpers (`addComment`/`replyToComment`/`resolveComment`) are
// client-only — there is no server-side mutation path in this route.
import {
  type ApiFailure,
  apiFailureFromResponse,
  NETWORK_ERROR_MESSAGE,
  networkFailure,
} from "./http";
import type { CommentWire, ListEnvelope } from "./wire-types";

export interface CommentsRequestInput {
  readonly appOrigin: string;
  readonly slug: string;
  readonly editToken: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

export type ListCommentsResult =
  | { readonly ok: true; readonly comments: readonly CommentWire[] }
  | ApiFailure;

export async function listComments(input: CommentsRequestInput): Promise<ListCommentsResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    // v1 cap (claude-review #184): a single `limit=100` page — the envelope's
    // `has_more` is intentionally not consumed, so a report with >100 comments
    // silently shows only the first page. A "load more"/cursor follow is
    // deferred to the Phase 5 cutover; this is NOT "shows everything".
    response = await fetchImpl(
      `${input.appOrigin}/api/v1/reports/${input.slug}/comments?limit=100`,
      {
        method: "GET",
        credentials: "omit",
        headers: { authorization: `Bearer ${input.editToken}` },
      },
    );
  } catch {
    return networkFailure(NETWORK_ERROR_MESSAGE);
  }
  if (!response.ok) return apiFailureFromResponse(response, "Failed to load comments");
  const body = (await response.json()) as ListEnvelope<CommentWire>;
  return { ok: true, comments: body.data };
}

/** The anchor shape `buildSelectionAnchor` (arp-editor) produces, wire-encoded
 *  by these helpers before POSTing — mirrors `api.v1.reports.$slug.comments.
 *  ts`'s `parseAnchor` input exactly (`{ version_pinned: { version_id,
 *  text_quote }, relative? }`). */
export interface WireAnchorInput {
  readonly versionId: string;
  readonly textQuote: string;
  readonly relative?: unknown;
}

function anchorToWire(anchor: WireAnchorInput) {
  return {
    version_pinned: { version_id: anchor.versionId, text_quote: anchor.textQuote },
    ...(anchor.relative !== undefined ? { relative: anchor.relative } : {}),
  };
}

export type CommentWriteResult = { readonly ok: true; readonly comment: CommentWire } | ApiFailure;

async function postComment(
  input: CommentsRequestInput & { readonly body: string; readonly anchor: WireAnchorInput },
  extra: Record<string, unknown>,
): Promise<CommentWriteResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${input.appOrigin}/api/v1/reports/${input.slug}/comments`, {
      method: "POST",
      credentials: "omit",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.editToken}`,
      },
      body: JSON.stringify({ body: input.body, anchor: anchorToWire(input.anchor), ...extra }),
    });
  } catch {
    return networkFailure(NETWORK_ERROR_MESSAGE);
  }
  if (!response.ok) return apiFailureFromResponse(response, "Failed to post comment");
  const comment = (await response.json()) as CommentWire;
  return { ok: true, comment };
}

export interface AddCommentInput extends CommentsRequestInput {
  readonly body: string;
  readonly anchor: WireAnchorInput;
  /** What the author wants done with the comment (ADR-0064 Decision 8).
   *  Omit to default to `note` server-side. */
  readonly intent?: string;
}

/** POST a root comment (starts a new Thread) — anchored to a fresh editor
 *  selection. */
export async function addComment(input: AddCommentInput): Promise<CommentWriteResult> {
  return postComment(input, input.intent === undefined ? {} : { intent: input.intent });
}

export interface ReplyCommentInput extends AddCommentInput {
  readonly parentCommentId: string;
}

/** POST a reply — a comment resource on the wire too, just with `parent_id`
 *  set (single-level threading, ADR-0064). */
export async function replyToComment(input: ReplyCommentInput): Promise<CommentWriteResult> {
  return postComment(input, {
    parent_comment_id: input.parentCommentId,
    ...(input.intent === undefined ? {} : { intent: input.intent }),
  });
}

export interface ResolveCommentInput extends CommentsRequestInput {
  readonly commentId: string;
}

/** PATCH .../comments/{comment_id} — resolve. Idempotent; no request body
 *  (the API's resolve handler doesn't parse one — there is only the one
 *  resolved transition). */
export async function resolveComment(input: ResolveCommentInput): Promise<CommentWriteResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(
      `${input.appOrigin}/api/v1/reports/${input.slug}/comments/${input.commentId}`,
      {
        method: "PATCH",
        credentials: "omit",
        headers: { authorization: `Bearer ${input.editToken}` },
      },
    );
  } catch {
    return networkFailure(NETWORK_ERROR_MESSAGE);
  }
  if (!response.ok) return apiFailureFromResponse(response, "Failed to resolve comment");
  const comment = (await response.json()) as CommentWire;
  return { ok: true, comment };
}
