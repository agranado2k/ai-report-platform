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
import { fetchAllPages } from "./fetch-all-pages";
import {
  type ApiFailure,
  apiFailureFromResponse,
  NETWORK_ERROR_MESSAGE,
  networkFailure,
} from "./http";
import type { CommentWire } from "./wire-types";

export interface CommentsRequestInput {
  readonly appOrigin: string;
  readonly slug: string;
  readonly editToken: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

export type ListCommentsResult =
  | {
      readonly ok: true;
      readonly comments: readonly CommentWire[];
      /** Cursor exhausted? `false` means the full set is loaded. It can only be
       *  `true` if the fetch-all loop hit its `MAX_PAGES` safety cap while the
       *  server still had more — i.e. the returned set is TRUNCATED (see the
       *  loop below). The loader surfaces that pathological case rather than
       *  silently claiming completeness (the exact claude-review #184 bug). */
      readonly has_more: boolean;
    }
  | ApiFailure;

// PAGINATION (ADR-0053): the shared `fetchAllPages` helper walks the cursor
// envelope (`{ data, has_more }` + `starting_after=<last id>`) to load the
// COMPLETE comment set — same loop versions-client.ts uses (DRY). `has_more`
// stays observable (true only when the set was truncated at the page cap).
export async function listComments(input: CommentsRequestInput): Promise<ListCommentsResult> {
  const result = await fetchAllPages<CommentWire>({
    appOrigin: input.appOrigin,
    slug: input.slug,
    editToken: input.editToken,
    resource: "comments",
    errorMessage: "Failed to load comments",
    fetchImpl: input.fetchImpl,
  });
  if (!result.ok) return result;
  return { ok: true, comments: result.items, has_more: result.has_more };
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

export interface EditCommentInput extends CommentsRequestInput {
  readonly commentId: string;
  /** New body — omit to leave it unchanged. */
  readonly body?: string;
  /** New intent — omit to leave it unchanged. */
  readonly intent?: string;
  /** Optimistic-concurrency token: the `edited_at` (ISO-8601) the client last
   *  saw for this comment, or null if it had never been edited. Sent as
   *  `expected_edited_at`; the app-origin rejects the edit with a 409 if the
   *  stored value has since changed. Omit to skip the concurrency check. */
  readonly expectedEditedAt?: string | null;
}

/** PATCH .../comments/{comment_id} — EDIT body and/or intent. Distinguished from
 *  resolve by the presence of a JSON body: the app-origin PATCH handler
 *  dispatches on the body shape (a `body`/`intent` field → edit; no body →
 *  resolve). Sends `expected_edited_at` (when provided) as the
 *  optimistic-concurrency token. Returns the updated comment resource (200), or
 *  an ApiFailure whose message carries the 409 conflict detail on a stale edit. */
export async function editComment(input: EditCommentInput): Promise<CommentWriteResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(
      `${input.appOrigin}/api/v1/reports/${input.slug}/comments/${input.commentId}`,
      {
        method: "PATCH",
        credentials: "omit",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${input.editToken}`,
        },
        body: JSON.stringify({
          ...(input.body !== undefined ? { body: input.body } : {}),
          ...(input.intent !== undefined ? { intent: input.intent } : {}),
          ...(input.expectedEditedAt !== undefined
            ? { expected_edited_at: input.expectedEditedAt }
            : {}),
        }),
      },
    );
  } catch {
    return networkFailure(NETWORK_ERROR_MESSAGE);
  }
  if (!response.ok) return apiFailureFromResponse(response, "Failed to edit comment");
  const comment = (await response.json()) as CommentWire;
  return { ok: true, comment };
}
