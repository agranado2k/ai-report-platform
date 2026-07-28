// arp-http request-parse helpers (driving side). parseJsonBody turns a Fetch
// Request into a JSON object, or a typed AppError the route renders via
// errorToHttp: non-JSON content-type → 415, malformed / non-object → 422.
import {
  type AppError,
  err,
  type Intent,
  makeIntent,
  ok,
  type Result,
  validationError,
} from "arp-domain";

export async function parseJsonBody(
  request: Request,
): Promise<Result<Record<string, unknown>, AppError>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return err({ kind: "UnsupportedMediaType", message: "expected application/json" });
  }
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return err({ kind: "ValidationError", message: "body must be a JSON object" });
    }
    return ok(body as Record<string, unknown>);
  } catch {
    return err({ kind: "ValidationError", message: "malformed JSON body" });
  }
}

/** The two intents PATCH /comments/{comment_id} dispatches to, decided by the
 *  request body shape (ADR-0064 §7 — one route, verb overloaded on the body):
 *  a body carrying `body` and/or `intent` is an EDIT of those fields; an
 *  empty/absent body is the (unchanged) RESOLVE. */
export type CommentPatch =
  | { readonly kind: "resolve" }
  | {
      readonly kind: "edit";
      readonly body?: string;
      readonly intent?: Intent;
      /** Optimistic-concurrency token (epoch ms) parsed from the request's
       *  `expected_edited_at` (an ISO-8601 date-time, or explicit null): the
       *  `edited_at` the client last saw. `undefined` when the field is omitted
       *  (concurrency check skipped); `null` when the client asserts the comment
       *  had never been edited. Only carried on the EDIT path — the resolve path
       *  ignores it. */
      readonly expectedEditedAt?: number | null;
    };

/**
 * Classify a PATCH /comments/{comment_id} request body into resolve-vs-edit
 * (ADR-0064 §7). `body` is the already-parsed JSON object, or `undefined` when
 * the request carried no JSON body at all (the resolve path sends none). Rules:
 *  - no body, or a body with neither `body` nor `intent` key → `resolve`.
 *  - `body` present → must be a non-empty string (422 otherwise — the domain
 *    also re-validates length/emptiness on the trimmed value).
 *  - `intent` present → validated by `makeIntent` (422 on an invalid value,
 *    same as create/reply); the validated `Intent` is carried forward.
 *  - `expected_edited_at` present (EDIT path only) → an ISO-8601 date-time
 *    (parsed to epoch ms) or explicit null; anything else → 422. Ignored on the
 *    resolve path (a body carrying only `expected_edited_at` is still a resolve).
 * Keeping this a pure function (no `Request`) makes the dispatch unit-testable
 * without a live route.
 */
export function parseCommentPatch(
  body: Record<string, unknown> | undefined,
): Result<CommentPatch, AppError> {
  const hasBody = body !== undefined && "body" in body;
  // An explicit `intent: null` means "leave the intent unchanged" (absent), NOT
  // "reset to note" — `makeIntent(null)` defaults to note, which would silently
  // clobber the field, so treat null the same as omitted (claude-review #201).
  const hasIntent =
    body !== undefined && "intent" in body && (body as Record<string, unknown>).intent !== null;
  if (!hasBody && !hasIntent) return ok({ kind: "resolve" });

  let editBody: string | undefined;
  let editIntent: Intent | undefined;
  if (hasBody) {
    const raw = (body as Record<string, unknown>).body;
    if (typeof raw !== "string" || raw.trim().length === 0) {
      return err(validationError("comment body must be a non-empty string", "body"));
    }
    editBody = raw;
  }
  if (hasIntent) {
    const intent = makeIntent((body as Record<string, unknown>).intent);
    if (!intent.ok) return intent;
    editIntent = intent.value;
  }

  // Optimistic-concurrency token (optional). Absent → `undefined` (check
  // skipped downstream). `null` → the client asserts "never edited". A string →
  // parsed as an ISO-8601 date-time to epoch ms (mirrors how `edited_at` is
  // rendered on the wire); an unparseable string, or any non-string/non-null,
  // is a 422.
  let expectedEditedAt: number | null | undefined;
  if (body !== undefined && "expected_edited_at" in body) {
    const raw = (body as Record<string, unknown>).expected_edited_at;
    if (raw === null) {
      expectedEditedAt = null;
    } else if (typeof raw === "string") {
      const ms = Date.parse(raw);
      if (Number.isNaN(ms)) {
        return err(
          validationError(
            "expected_edited_at must be an ISO-8601 date-time or null",
            "expected_edited_at",
          ),
        );
      }
      expectedEditedAt = ms;
    } else {
      return err(
        validationError(
          "expected_edited_at must be an ISO-8601 date-time or null",
          "expected_edited_at",
        ),
      );
    }
  }

  return ok({ kind: "edit", body: editBody, intent: editIntent, expectedEditedAt });
}
