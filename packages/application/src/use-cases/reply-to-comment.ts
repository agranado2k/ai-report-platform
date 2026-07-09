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
  notFound,
  ok,
  type Result,
  type Slug,
} from "arp-domain";
import { loadWritableReport, type TenancyActor, type WriteGrantCheckDeps } from "../load-owned";
import type {
  AuditLogger,
  Clock,
  CommentRepository,
  EventOutbox,
  IdGenerator,
  ReportRepository,
  UnitOfWork,
} from "../ports";

export interface ReplyToCommentDeps extends WriteGrantCheckDeps {
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
    createdAt: deps.clock.now(),
  });
  if (!emission.ok) return emission;

  const committed = await deps.uow.run(async () => {
    const saved = await deps.comments.save(emission.value.comment);
    if (!saved.ok) return saved;
    const enqueued = await deps.outbox.enqueue(emission.value.events);
    if (!enqueued.ok) return enqueued;
    return deps.audit.record([
      {
        action: "comment.replied",
        orgId: actor.orgId,
        actorUserId: actor.userId,
        targetType: "comment",
        targetId: emission.value.comment.id,
        meta: { reportId: report.value.id, parentId: input.parentCommentId },
      },
    ]);
  });
  if (!committed.ok) return committed;

  return ok(emission.value.comment);
}
