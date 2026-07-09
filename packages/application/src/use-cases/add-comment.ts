// addComment — start a new Thread (a root Comment) anchored to a location in a
// report's document (ADR-0064). Authorization: `canWrite` (ADR-0064 §3 —
// "gated the same way report writes are"): `isOwner OR hasWriteGrant`
// (ADR-0060 §4, real as of PR #150 — no longer schema-only), via the shared
// loadWritableReport guard — the SAME seam renameReport/moveReport/uploadReport
// use, NOT the permanently-owner-only loadOwnedReport (that seam is reserved
// for delete/setAcl/grant-management, ADR-0059 §2 — commenting is not that).
// A cross-org write-grantee can therefore author a comment on a report outside
// their own org, same as they can rename/re-upload/move it. Pure orchestration
// over the driven ports (ADR-0024): load+authz → the domain createComment
// transition → persist + outbox the CommentAdded event + a `comment.added`
// audit_log row (ADR-0070), all atomically (ADR-0064 §6 / ADR-0037 §5,
// mirrors processScanResult's uow.run shape).
import {
  type Anchor,
  type AppError,
  type Comment,
  createComment,
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

export interface AddCommentDeps extends WriteGrantCheckDeps {
  readonly reports: ReportRepository;
  readonly comments: CommentRepository;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly outbox: EventOutbox;
  /** Audit log (ADR-0070) — one `comment.added` row per new root comment. */
  readonly audit: AuditLogger;
  readonly uow: UnitOfWork;
}
export type AddCommentActor = TenancyActor;
export interface AddCommentInput {
  readonly slug: Slug;
  readonly body: string;
  readonly anchor: Anchor;
}

export async function addComment(
  deps: AddCommentDeps,
  actor: AddCommentActor,
  input: AddCommentInput,
): Promise<Result<Comment, AppError>> {
  const report = await loadWritableReport(deps.reports, actor, input.slug, deps);
  if (!report.ok) return report;

  const emission = createComment({
    id: deps.ids.commentId(),
    reportId: report.value.id,
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
        action: "comment.added",
        orgId: actor.orgId,
        actorUserId: actor.userId,
        targetType: "comment",
        targetId: emission.value.comment.id,
        meta: { reportId: report.value.id },
      },
    ]);
  });
  if (!committed.ok) return committed;

  return ok(emission.value.comment);
}
