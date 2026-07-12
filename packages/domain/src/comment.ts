// Comment — the aggregate root of the Authoring & Collaboration bounded context
// (ADR-0036, ADR-0064). Pure: every transition returns a new Comment plus the
// domain events it emitted, mirroring report.ts's Emission pattern (ADR-024, no
// I/O here — persistence lives in adapters, ADR-020).
import type { Anchor } from "./anchor";
import { validateAnchor } from "./anchor";
import type { CommentId, ReportId, UserId } from "./brand";
import type { AppError } from "./errors";
import { validationError } from "./errors";
import type { CommentAdded, CommentEdited, CommentResolved, DomainEvent } from "./events";
import { type Intent, makeIntent } from "./intent";
import { err, ok, type Result } from "./result";

export interface Comment {
  readonly id: CommentId;
  readonly reportId: ReportId;
  readonly authorUserId: UserId;
  /** A short annotation, not a document — bounded (see MAX_BODY below). */
  readonly body: string;
  readonly anchor: Anchor;
  /** null = a root comment (starts a Thread); set = a reply to that root. A
   *  reply's parent is always itself a root — enforced by replyToComment, never
   *  a self-referential chain (ADR-0064 Decision 2/4: single-level threading). */
  readonly parentCommentId: CommentId | null;
  /** What the author wants DONE with this comment (ADR-0064 Decision 8).
   *  Defaults to `note` (a plain human annotation) — a pre-existing comment
   *  persisted before this field reads as `note` (backward compat, intent.ts). */
  readonly intent: Intent;
  readonly resolvedAt: number | null;
  readonly createdAt: number;
}

/** A state transition's result: the new aggregate state + the events it raised
 *  (mirrors report.ts's `Emission`; named distinctly so the domain barrel export
 *  doesn't clash). */
export interface CommentEmission {
  readonly comment: Comment;
  readonly events: readonly DomainEvent[];
}

// JUDGMENT CALL: ADR-0064 §2 says a comment body is "bounded length — a short
// annotation, not a document" but gives no number. 2000 chars mirrors the
// anchor's own text-quote cap (anchor.ts) — generous for a discussion comment,
// far short of "a document."
const MAX_BODY = 2000;

function validateBody(body: string): Result<string, AppError> {
  const trimmed = body.trim();
  if (trimmed.length === 0) return err(validationError("comment body is required", "body"));
  if (trimmed.length > MAX_BODY) {
    return err(validationError(`comment body too long (max ${MAX_BODY})`, "body"));
  }
  return ok(trimmed);
}

export interface CreateCommentParams {
  readonly id: CommentId;
  readonly reportId: ReportId;
  readonly authorUserId: UserId;
  readonly body: string;
  readonly anchor: Anchor;
  /** Optional — defaults to `note` (intent.ts). */
  readonly intent?: Intent;
  readonly createdAt: number;
}

/** Start a new Thread: a root Comment (parentCommentId = null) anchored to a
 *  location in the report's document. Emits CommentAdded. */
export function createComment(p: CreateCommentParams): Result<CommentEmission, AppError> {
  const body = validateBody(p.body);
  if (!body.ok) return body;
  const anchor = validateAnchor(p.anchor);
  if (!anchor.ok) return anchor;
  const intent = makeIntent(p.intent);
  if (!intent.ok) return intent;

  const comment: Comment = {
    id: p.id,
    reportId: p.reportId,
    authorUserId: p.authorUserId,
    body: body.value,
    anchor: anchor.value,
    parentCommentId: null,
    intent: intent.value,
    resolvedAt: null,
    createdAt: p.createdAt,
  };
  const event: CommentAdded = {
    type: "CommentAdded",
    commentId: p.id,
    reportId: p.reportId,
    authorUserId: p.authorUserId,
    parentCommentId: null,
  };
  return ok({ comment, events: [event] });
}

export interface ReplyToCommentParams {
  readonly id: CommentId;
  readonly authorUserId: UserId;
  readonly body: string;
  readonly anchor: Anchor;
  /** Optional — defaults to `note` (intent.ts). */
  readonly intent?: Intent;
  readonly createdAt: number;
}

/** Reply to a root Comment — single-level threading (ADR-0064 Decision 2/4): a
 *  reply may only target a ROOT comment (`parent.parentCommentId === null`);
 *  replying to a reply is rejected with a ValidationError. Emits CommentAdded
 *  (a reply IS a Comment — same event, `parentCommentId` set). */
export function replyToComment(
  parent: Comment,
  p: ReplyToCommentParams,
): Result<CommentEmission, AppError> {
  if (parent.parentCommentId !== null) {
    return err(
      validationError("cannot reply to a reply (single-level threading)", "parentCommentId"),
    );
  }
  const body = validateBody(p.body);
  if (!body.ok) return body;
  const anchor = validateAnchor(p.anchor);
  if (!anchor.ok) return anchor;
  const intent = makeIntent(p.intent);
  if (!intent.ok) return intent;

  const comment: Comment = {
    id: p.id,
    reportId: parent.reportId,
    authorUserId: p.authorUserId,
    body: body.value,
    anchor: anchor.value,
    parentCommentId: parent.id,
    intent: intent.value,
    resolvedAt: null,
    createdAt: p.createdAt,
  };
  const event: CommentAdded = {
    type: "CommentAdded",
    commentId: p.id,
    reportId: parent.reportId,
    authorUserId: p.authorUserId,
    parentCommentId: parent.id,
  };
  return ok({ comment, events: [event] });
}

/**
 * Resolve a Comment. Idempotent (JUDGMENT CALL, mirrors applyScanResult's
 * idempotent-absorb style in report.ts): resolving an already-resolved comment
 * is a no-op — the existing `resolvedAt` is kept and no duplicate
 * CommentResolved is emitted. The use case enforces WHO may call this
 * (author-or-owner, ADR-0064 §3); this transition itself doesn't check identity.
 */
export function resolveComment(comment: Comment, resolvedAt: number): CommentEmission {
  if (comment.resolvedAt !== null) {
    return { comment, events: [] };
  }
  const updated: Comment = { ...comment, resolvedAt };
  const event: CommentResolved = {
    type: "CommentResolved",
    commentId: comment.id,
    reportId: comment.reportId,
    resolvedAt,
  };
  return { comment: updated, events: [event] };
}

export interface EditCommentParams {
  /** New body — DEFINED means "replace" (validated by validateBody); absent
   *  (undefined) means "leave the current body unchanged". */
  readonly body?: string;
  /** New intent — DEFINED means "replace" (must already be a valid `Intent`,
   *  validated at the trust boundary by `makeIntent`); absent means "leave the
   *  current intent unchanged". */
  readonly intent?: Intent;
  readonly editedAt: number;
}

/**
 * Edit a Comment's `body` and/or `intent` (ADR-0064 §3). v1 scope: only these
 * two fields are mutable — the anchor is immutable, and there is no `edited_at`
 * indicator yet (a migration-free fast-follow). At least one of `body`/`intent`
 * must be provided; neither is a ValidationError (the caller has nothing to
 * edit). The body is revalidated (non-empty, bounded — same VO as create); the
 * intent is applied as-is (already a valid `Intent` at this point). Emits
 * CommentEdited. The use case enforces WHO may call this (author-or-owner,
 * ADR-0064 §3, mirroring resolve/delete); this transition doesn't check identity.
 */
export function editComment(
  comment: Comment,
  p: EditCommentParams,
): Result<CommentEmission, AppError> {
  if (p.body === undefined && p.intent === undefined) {
    return err(validationError("nothing to edit: provide body and/or intent", "body"));
  }
  let next = comment;
  if (p.body !== undefined) {
    const body = validateBody(p.body);
    if (!body.ok) return body;
    next = { ...next, body: body.value };
  }
  if (p.intent !== undefined) {
    // Belt-and-braces re-validation (mirrors createComment's makeIntent on an
    // already-typed Intent): a value cast past the type boundary is still caught.
    const intent = makeIntent(p.intent);
    if (!intent.ok) return intent;
    next = { ...next, intent: intent.value };
  }
  const event: CommentEdited = {
    type: "CommentEdited",
    commentId: comment.id,
    reportId: comment.reportId,
    editedAt: p.editedAt,
  };
  return ok({ comment: next, events: [event] });
}
