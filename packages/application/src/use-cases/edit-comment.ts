// editComment — edit a Comment's `body` and/or `intent` (ADR-0064 §3). v1 scope:
// only those two fields are mutable (the anchor is immutable, and there is no
// `edited_at` indicator yet — a migration-free fast-follow). Authorization is a
// DELIBERATE mirror of resolve/delete (author-OR-report-owner, ADR-0064 §3 /
// ADR-0060 §4), NOT the create/reply `canWrite` gate: editing your own comment's
// text is a moderation-shaped act on your own content, and the owner is the final
// authority over every comment on their report. Same base gate as resolveComment
// (loadReadableReport — owner OR org-visible OR write-grantee) so a cross-org
// write-grantee who authored a comment can still edit their OWN comment outside
// the report's org, exactly as they could when they wrote it. A comment belonging
// to a DIFFERENT report than the slug names reads as NotFound (never leaks
// cross-report existence). Pure orchestration over the driven ports (ADR-0024):
// load+authz → the domain editComment transition → persist + outbox the
// CommentEdited event + a `comment.edited` audit_log row (ADR-0070), all
// atomically (mirrors resolveComment's uow.run shape).
import {
  type AppError,
  editComment as applyEdit,
  type Comment,
  type CommentId,
  err,
  type Intent,
  notAllowed,
  notFound,
  ok,
  type Result,
  type Slug,
} from "arp-domain";
import { loadReadableReport, type TenancyActor, type WriteGrantCheckDeps } from "../load-owned";
import type {
  AuditLogger,
  Clock,
  CommentRepository,
  EventOutbox,
  ReportRepository,
  UnitOfWork,
} from "../ports";

export interface EditCommentDeps extends WriteGrantCheckDeps {
  readonly reports: ReportRepository;
  readonly comments: CommentRepository;
  readonly clock: Clock;
  readonly outbox: EventOutbox;
  /** Audit log (ADR-0070) — one `comment.edited` row per edit. */
  readonly audit: AuditLogger;
  readonly uow: UnitOfWork;
}
export type EditCommentActor = TenancyActor;
export interface EditCommentInput {
  readonly slug: Slug;
  readonly commentId: CommentId;
  /** New body — present means replace; absent means leave unchanged. */
  readonly body?: string;
  /** New intent (already validated at the trust boundary) — present means
   *  replace; absent means leave unchanged. */
  readonly intent?: Intent;
}

export async function editComment(
  deps: EditCommentDeps,
  actor: EditCommentActor,
  input: EditCommentInput,
): Promise<Result<Comment, AppError>> {
  const report = await loadReadableReport(deps.reports, actor, input.slug, deps);
  if (!report.ok) return report;

  const found = await deps.comments.findById(input.commentId);
  if (!found.ok) return found;
  if (!found.value || found.value.reportId !== report.value.id) {
    return err(notFound("comment not found"));
  }
  const comment = found.value;

  const canModerate =
    actor.userId === report.value.ownerId || actor.userId === comment.authorUserId;
  if (!canModerate) {
    return err(notAllowed("only the comment's author or the report's owner may edit it"));
  }

  const emission = applyEdit(comment, {
    body: input.body,
    intent: input.intent,
    editedAt: deps.clock.now(),
  });
  if (!emission.ok) return emission;

  const committed = await deps.uow.run(async () => {
    const saved = await deps.comments.save(emission.value.comment);
    if (!saved.ok) return saved;
    const enqueued = await deps.outbox.enqueue(emission.value.events);
    if (!enqueued.ok) return enqueued;
    return deps.audit.record([
      {
        action: "comment.edited",
        orgId: actor.orgId,
        actorUserId: actor.userId,
        targetType: "comment",
        targetId: comment.id,
        meta: { reportId: report.value.id },
      },
    ]);
  });
  if (!committed.ok) return committed;

  return ok(emission.value.comment);
}
