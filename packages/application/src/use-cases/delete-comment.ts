// deleteComment — hard-delete a Comment (ADR-0064 §3): "the comment's author OR
// the report's owner may... delete it" — same author-or-owner rule as
// resolveComment, NOT `canWrite`. The base existence/visibility gate is
// loadReadableReport (owner OR org-visible OR write-grantee) for the same
// reason resolveComment uses it: a comment's author may be a cross-org
// write-grantee (canWrite covers write grants as of PR #150), and they must be
// able to delete their own comment outside the report's org. Deleting a root
// also deletes its replies (the DB's self-FK CASCADE, schema.ts's FK-policy
// note; the repository contract covers this). No domain event fires on delete
// (docs/events.md's catalog only has CommentAdded/CommentResolved) — a plain
// repository operation once authorized, no outbox/uow needed.
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
import type { CommentRepository, ReportRepository } from "../ports";

export interface DeleteCommentDeps extends WriteGrantCheckDeps {
  readonly reports: ReportRepository;
  readonly comments: CommentRepository;
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

  return deps.comments.delete(input.commentId);
}
