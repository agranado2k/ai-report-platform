// deleteComment — hard-delete a Comment (ADR-0064 §3): "the comment's author OR
// the report's owner may... delete it" — same author-or-owner rule as
// resolveComment, NOT `canWrite`. The base existence/visibility gate is
// loadReadableReport (owner OR org-visible OR write-grantee) for the same
// reason resolveComment uses it: a comment's author may be a cross-org
// write-grantee (canWrite covers write grants as of PR #150), and they must be
// able to delete their own comment outside the report's org. Deleting a root
// also deletes its replies (the DB's self-FK CASCADE, schema.ts's FK-policy
// note; the repository contract covers this). No domain event fires on delete
// (docs/events.md's catalog only has CommentAdded/CommentResolved), but the
// delete + a `comment.deleted` audit_log row (ADR-0070) now commit together
// in one UnitOfWork (ADR-0037 section 5).
import {
  type AppError,
  type CommentId,
  err,
  notAllowed,
  notFound,
  type Result,
  type Slug,
} from "arp-domain";
import { loadReadableReport, type TenancyActor, type WriteGrantCheckDeps } from "../load-owned";
import type { AuditLogger, CommentRepository, ReportRepository, UnitOfWork } from "../ports";

export interface DeleteCommentDeps extends WriteGrantCheckDeps {
  readonly reports: ReportRepository;
  readonly comments: CommentRepository;
  /** Audit log (ADR-0070) -- one `comment.deleted` row per delete. */
  readonly audit: AuditLogger;
  readonly uow: UnitOfWork;
}
export type DeleteCommentActor = TenancyActor;
export interface DeleteCommentInput {
  readonly slug: Slug;
  readonly commentId: CommentId;
}

export async function deleteComment(
  deps: DeleteCommentDeps,
  actor: DeleteCommentActor,
  input: DeleteCommentInput,
): Promise<Result<void, AppError>> {
  const report = await loadReadableReport(deps.reports, actor, input.slug, deps);
  if (!report.ok) return report;

  const found = await deps.comments.findById(input.commentId);
  if (!found.ok) return found;
  if (!found.value || found.value.reportId !== report.value.id) {
    return err(notFound("comment not found"));
  }

  const canModerate =
    actor.userId === report.value.ownerId || actor.userId === found.value.authorUserId;
  if (!canModerate) {
    return err(notAllowed("only the comment's author or the report's owner may delete it"));
  }

  const reportId = report.value.id;
  const targetCommentId = input.commentId;
  return deps.uow.run(async () => {
    const deleted = await deps.comments.delete(targetCommentId);
    if (!deleted.ok) return deleted;
    return deps.audit.record([
      {
        action: "comment.deleted",
        orgId: actor.orgId,
        actorUserId: actor.userId,
        targetType: "comment",
        targetId: targetCommentId,
        meta: { reportId },
      },
    ]);
  });
}
