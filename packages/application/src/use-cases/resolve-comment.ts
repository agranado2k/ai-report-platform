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
import { commitWrite } from "../commit-write";
import {
  beginIdempotentWrite,
  type IdempotentWriteDeps,
  reviveCommentReplay,
} from "../idempotent-write";
import { loadReadableReport, type TenancyActor, type WriteGrantCheckDeps } from "../load-owned";
import type {
  AuditLogger,
  Clock,
  CommentRepository,
  EventOutbox,
  ReportRepository,
  UnitOfWork,
} from "../ports";

// Same wire route as editComment (PATCH is overloaded on body shape) — the
// "resolve" discriminator segment in the fingerprint keeps the two apart.
const ROUTE = "PATCH /api/v1/reports/{slug}/comments/{comment_id}";

export interface ResolveCommentDeps extends WriteGrantCheckDeps, IdempotentWriteDeps {
  readonly reports: ReportRepository;
  readonly comments: CommentRepository;
  readonly clock: Clock;
  readonly outbox: EventOutbox;
  /** Audit log (ADR-0070) — one `comment.resolved` row per resolve. */
  readonly audit: AuditLogger;
  readonly uow: UnitOfWork;
}
export type ResolveCommentActor = TenancyActor;
export interface ResolveCommentInput {
  readonly slug: Slug;
  readonly commentId: CommentId;
  /** The client's explicit `Idempotency-Key` header (ADR-0039), when sent. */
  readonly idempotencyKey?: string;
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

  // Idempotency (ADR-0039) — belt-and-braces on top of the domain transition's
  // own already-resolved no-op: a retried resolve replays the recorded comment.
  const idem = await beginIdempotentWrite(deps, {
    actingUserId: actor.userId,
    route: ROUTE,
    // ADR-0039 derived fallback: sets resolved state; re-resolving is a domain no-op either way
    derivedFallback: "unsound",
    key: input.idempotencyKey,
    fingerprint: [input.slug, input.commentId, "resolve"],
  });
  if (!idem.ok) return idem;
  if (idem.value.outcome === "replay") return reviveCommentReplay(idem.value.record);
  const idemRef = idem.value.ref;

  const emission = applyResolve(comment, deps.clock.now());
  const committed = await commitWrite(
    deps,
    {
      idemRef,
      audit: () => [
        {
          action: "comment.resolved",
          orgId: actor.orgId,
          actorUserId: actor.userId,
          targetType: "comment",
          targetId: comment.id,
          meta: { reportId: report.value.id },
        },
      ],
      response: (c) => ({ responseStatus: 200, responseBody: c }),
    },
    async () => {
      const saved = await deps.comments.save(emission.comment);
      if (!saved.ok) return saved;
      const enqueued = await deps.outbox.enqueue(emission.events);
      return enqueued.ok ? ok(emission.comment) : enqueued;
    },
  );
  if (!committed.ok) return committed;

  return ok(emission.comment);
}
