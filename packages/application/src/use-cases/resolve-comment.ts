// resolveComment — mark a Comment resolved (ADR-0064 §3): "the comment's author
// OR the report's owner may resolve it" — a DIFFERENT rule from `canWrite`, so
// this does NOT reuse loadWritableReport/loadOwnedReport directly for
// authorization. The report existence + visibility gate is loadReadableReport
// (owner OR org-visible OR write-grantee, ADR-0059 §3 / ADR-0060 §4) —
// JUDGMENT CALL: a comment's author may be a cross-org write-grantee (since
// addComment/replyToComment are canWrite-gated and canWrite now covers write
// grants, PR #150), so the base gate must let that author back in to resolve
// their OWN comment even outside the report's org, same as they could write
// it. The extra author-or-owner check is applied on top, against the loaded
// Comment. A comment belonging to a DIFFERENT report than the slug names
// reads as NotFound (never leaks cross-report existence). Idempotent — the
// domain resolveComment transition is a no-op on an already-resolved comment.
import {
  type AppError,
  resolveComment as applyResolve,
  type Comment,
  type CommentId,
  err,
  notAllowed,
  notFound,
  ok,
  type Result,
  type Slug,
} from "arp-domain";
import { loadReadableReport, type TenancyActor, type WriteGrantCheckDeps } from "../load-owned";
import type { Clock, CommentRepository, EventOutbox, ReportRepository, UnitOfWork } from "../ports";

export interface ResolveCommentDeps extends WriteGrantCheckDeps {
  readonly reports: ReportRepository;
  readonly comments: CommentRepository;
  readonly clock: Clock;
  readonly outbox: EventOutbox;
  readonly uow: UnitOfWork;
}
export type ResolveCommentActor = TenancyActor;
export interface ResolveCommentInput {
  readonly slug: Slug;
  readonly commentId: CommentId;
}

export async function resolveComment(
  deps: ResolveCommentDeps,
  actor: ResolveCommentActor,
  input: ResolveCommentInput,
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
    return err(notAllowed("only the comment's author or the report's owner may resolve it"));
  }

  const emission = applyResolve(comment, deps.clock.now());
  const committed = await deps.uow.run(async () => {
    const saved = await deps.comments.save(emission.comment);
    if (!saved.ok) return saved;
    return deps.outbox.enqueue(emission.events);
  });
  if (!committed.ok) return committed;

  return ok(emission.comment);
}
