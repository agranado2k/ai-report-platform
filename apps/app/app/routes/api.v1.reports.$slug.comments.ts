// GET  /api/v1/reports/{slug}/comments — list a report's comments (cursor-
// paginated, ADR-0064 §7). Auth is IDENTICAL to GET /api/v1/reports/{slug}/
// versions — the shared org-scoped loadOrgReport guard (ADR-0059 §3). Comments
// never surface on the public viewer (ADR-0064 §4) — this route only exists on
// the app origin.
// POST /api/v1/reports/{slug}/comments — create a root comment, OR (when the
// body carries `parent_comment_id`) reply to one. Both are `canWrite`-gated
// (ADR-0064 §3) via addComment/replyToComment. A reply IS a comment resource on
// the wire (201), just with `parent_id` set.
// Thin transport adapter over the deepened `handle()` seam + `ops()` — this
// file keeps only the anchor/intent/parent parsing.
//
// CORS (ADR-0063): wrapped in `corsRoute` — the view-origin editor calls
// this cross-origin, carrying its edit token as a Bearer header (never a
// cookie), so the response needs `Access-Control-Allow-Origin` echoed for
// the configured VIEW_ORIGIN, and an `OPTIONS` preflight answered before any
// auth runs. Auth itself is unchanged — the edit-token branch is the last
// front door of the resolve-actor cascade (ADR-0063).
import {
  type Anchor,
  type AppError,
  type Comment,
  err,
  makeCommentId,
  makeIntent,
  makeVersionId,
  ok,
  type Result,
  validationError,
} from "arp-domain";
import { addCommentToHttp, listCommentsToHttp, parseCursorParams } from "arp-http";
import { resolveAuthorIdentities } from "../server/author-email.server";
import { uniqueCommentAuthorIds } from "../server/comment-dto.server";
import { identityStore, ops } from "../server/container.server";
import { corsRoute } from "../server/cors.server";
import { handle, methods } from "../server/handle.server";
import { wireContext } from "../server/http.server";

const ALLOWED_METHODS = "GET, POST, OPTIONS";

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

export const loader = corsRoute(
  ALLOWED_METHODS,
  handle({
    mode: "read",
    slug: true,
    run: async ({ url, actor, slug }) => {
      const cursor = parseCursorParams(url.searchParams, makeCommentId);
      if (!cursor.ok) return cursor; // malformed cursor → 422

      const page = await ops().listComments({ orgId: actor.orgId }, { slug, ...cursor.value });
      if (!page.ok) return page;

      // ADR-0063 author display: resolve each unique author id → { name, email }
      // (ONE IdentityStore round-trip per distinct author), fold onto the wire below.
      const authorByUserId = await resolveAuthorIdentities(
        uniqueCommentAuthorIds(page.value.items),
        identityStore(),
      );
      return ok({ ...page.value, authorByUserId });
    },
    toHttp: (result) =>
      listCommentsToHttp(
        result,
        wireContext(),
        result.ok ? result.value.authorByUserId : undefined,
      ),
  }),
);

export const action = corsRoute(
  ALLOWED_METHODS,
  methods({
    POST: handle({
      mode: "write",
      slug: true,
      parseBody: true,
      run: async ({ actor, slug, body, idempotencyKey }) => {
        const anchor = parseAnchor(body.anchor);
        if (!anchor.ok) return anchor;
        // Optional; absent → `note`, an explicitly invalid value → 422 (ADR-0064
        // Decision 8), consistent with the anchor/cursor validation on this route.
        const intent = makeIntent(body.intent);
        if (!intent.ok) return intent;
        const commentBody = typeof body.body === "string" ? body.body : "";
        const commentActor = { orgId: actor.orgId, userId: actor.userId };

        const parentRaw = body.parent_comment_id;
        let created: Result<Comment, AppError>;
        if (typeof parentRaw === "string") {
          const parentCommentId = makeCommentId(parentRaw);
          if (!parentCommentId.ok) return parentCommentId;
          created = await ops().replyToComment(commentActor, {
            slug,
            parentCommentId: parentCommentId.value,
            body: commentBody,
            anchor: anchor.value,
            intent: intent.value,
            idempotencyKey,
          });
        } else {
          created = await ops().addComment(commentActor, {
            slug,
            body: commentBody,
            anchor: anchor.value,
            intent: intent.value,
            idempotencyKey,
          });
        }
        if (!created.ok) return created;

        // Same route-layer Author Identity projection as the GET list above
        // (ADR-0048/ADR-0063; 2026-07-29 dogfood paper cut #3): without it a
        // just-posted comment renders as "Unknown user" until the next reload.
        const authorByUserId = await resolveAuthorIdentities(
          uniqueCommentAuthorIds([created.value]),
          identityStore(),
        );
        return ok({ comment: created.value, authorByUserId });
      },
      toHttp: (result) =>
        addCommentToHttp(
          result.ok ? ok(result.value.comment) : result,
          wireContext(),
          result.ok ? result.value.authorByUserId : undefined,
        ),
    }),
  }),
);
