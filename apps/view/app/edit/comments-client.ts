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

/** Envelope page size. The API caps `limit` at 100 (ADR-0053). */
const PAGE_LIMIT = 100;
/** Safety bound on the fetch-all cursor loop: a report can never make the
 *  in-viewer client spin forever / exhaust memory. At `PAGE_LIMIT=100` this
 *  loads up to `MAX_PAGES * PAGE_LIMIT` comments before giving up and
 *  reporting `has_more: true` (truncated). No realistic report approaches
 *  this; it exists to fail loud (a logged truncation) instead of hanging. */
const MAX_PAGES = 20;

// PAGINATION (this change; supersedes the #184 "v1 cap"): follow the ADR-0053
// cursor envelope (`{ data, has_more }` + `starting_after=<last id>`) to load
// the COMPLETE comment set, so a report with >100 comments no longer silently
// truncates. Chosen over a "Load more" button (approach B) because the set is
// bounded by report size — no huge-list concern for a single report — and it
// needs no client-side accumulating state or panel affordance. `has_more` is
// consumed to drive the loop and returned (never discarded) so a cap-truncated
// set stays observable to the loader.
export async function listComments(input: CommentsRequestInput): Promise<ListCommentsResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const comments: CommentWire[] = [];
  let startingAfter: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${input.appOrigin}/api/v1/reports/${input.slug}/comments`);
    url.searchParams.set("limit", String(PAGE_LIMIT));
    if (startingAfter) url.searchParams.set("starting_after", startingAfter);

    let response: Response;
    try {
      response = await fetchImpl(url.toString(), {
        method: "GET",
        credentials: "omit",
        headers: { authorization: `Bearer ${input.editToken}` },
      });
    } catch {
      return networkFailure(NETWORK_ERROR_MESSAGE);
    }
    // A mid-pagination failure aborts the whole load (never a silent partial):
    // callers already degrade an errored list to empty (buildEditLoaderExtras).
    if (!response.ok) return apiFailureFromResponse(response, "Failed to load comments");

    const body = (await response.json()) as ListEnvelope<CommentWire>;
    comments.push(...body.data);

    const last = body.data[body.data.length - 1];
    // Drained (or a defensive empty page that still claims `has_more`): done.
    if (!body.has_more || !last) return { ok: true, comments, has_more: false };
    startingAfter = last.id;
  }

  // Hit the page cap with the cursor still open → the set is truncated.
  return { ok: true, comments, has_more: true };
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
