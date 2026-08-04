// replyToComment — reply to a root Comment, single-level threading (ADR-0064
// Decision 2/4). Authorization mirrors addComment exactly: `canWrite` via
// loadWritableReport (ADR-0064 §3 — `isOwner OR hasWriteGrant`, ADR-0060 §4,
// real as of PR #150). The parent must exist, belong to the SAME report, and
// be a root (the domain `replyToComment` transition enforces the "no reply to
// a reply" rule) — an unrelated or missing parent reads as NotFound, mirroring
// how listReportVersions/getReport treat a cross-report reference as absent
// rather than leaking its existence. Persist + outbox the CommentAdded event
// + a `comment.replied` audit_log row (ADR-0070) commit together, same shape
// as addComment.
import {
  type Anchor,
  type AppError,
  replyToComment as applyReply,
  type Comment,
  type CommentId,
  err,
  type Intent,
  notFound,
  ok,
  type Result,
  type Slug,
} from "arp-domain";
import {
  beginIdempotentWrite,
  type IdempotentWriteDeps,
  reviveCommentReplay,
} from "../idempotent-write";
import { type CanWriteDeps, loadWritableReport, type TenancyActor } from "../load-owned";
import type {
  AuditLogger,
  Clock,
  CommentRepository,
  EventOutbox,
  IdGenerator,
  ReportRepository,
  UnitOfWork,
} from "../ports";

// Same wire route as addComment (a reply IS a POST /comments with
// `parent_comment_id` set) — the parent id in the fingerprint disambiguates.
const ROUTE = "POST /api/v1/reports/{slug}/comments";

export interface ReplyToCommentDeps extends CanWriteDeps, IdempotentWriteDeps {
  readonly reports: ReportRepository;
  readonly comments: CommentRepository;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly outbox: EventOutbox;
  /** Audit log (ADR-0070) — one `comment.replied` row per reply. */
  readonly audit: AuditLogger;
  readonly uow: UnitOfWork;
}
export type ReplyToCommentActor = TenancyActor;
export interface ReplyToCommentInput {
  readonly slug: Slug;
  readonly parentCommentId: CommentId;
  readonly body: string;
  readonly anchor: Anchor;
  /** What the author wants done with the reply (ADR-0064 Decision 8).
   *  Optional — the domain defaults an absent intent to `note`. */
  readonly intent?: Intent;
  /** The client's explicit `Idempotency-Key` header (ADR-0039), when sent. */
  readonly idempotencyKey?: string;
}

export async function replyToComment(
  deps: ReplyToCommentDeps,
  actor: ReplyToCommentActor,
  input: ReplyToCommentInput,
): Promise<Result<Comment, AppError>> {
  const report = await loadWritableReport(deps.reports, actor, input.slug, deps);
  if (!report.ok) return report;

  const parentFound = await deps.comments.findById(input.parentCommentId);
  if (!parentFound.ok) return parentFound;
  if (!parentFound.value || parentFound.value.reportId !== report.value.id) {
    return err(notFound("comment not found"));
  }

  const emission = applyReply(parentFound.value, {
    id: deps.ids.commentId(),
    authorUserId: actor.userId,
    body: input.body,
    anchor: input.anchor,
    intent: input.intent,
    createdAt: deps.clock.now(),
  });
  if (!emission.ok) return emission;

  // Idempotency (ADR-0039): a retried reply replays the ORIGINAL comment
  // resource instead of posting a duplicate.
  const idem = await beginIdempotentWrite(deps, {
    actingUserId: actor.userId,
    route: ROUTE,
    key: input.idempotencyKey,
    fingerprint: [
      input.slug,
      input.parentCommentId,
      input.body,
      input.intent ?? "",
      input.anchor.versionPinned.versionId,
      input.anchor.versionPinned.textQuote,
    ],
  });
  if (!idem.ok) return idem;
  if (idem.value.outcome === "replay") return reviveCommentReplay(idem.value.record);
  const idemRef = idem.value.ref;

  const committed = await deps.uow.run(async () => {
    const saved = await deps.comments.save(emission.value.comment);
    if (!saved.ok) return saved;
    const enqueued = await deps.outbox.enqueue(emission.value.events);
    if (!enqueued.ok) return enqueued;
    const audited = await deps.audit.record([
      {
        action: "comment.replied",
        orgId: actor.orgId,
        actorUserId: actor.userId,
        targetType: "comment",
        targetId: emission.value.comment.id,
        meta: { reportId: report.value.id, parentId: input.parentCommentId },
      },
    ]);
    if (!audited.ok) return audited;
    return deps.idempotency.complete(idemRef, {
      responseStatus: 201,
      responseBody: emission.value.comment,
    });
  });
  if (!committed.ok) return committed;

  return ok(emission.value.comment);
}
