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
  type Intent,
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

const ROUTE = "POST /api/v1/reports/{slug}/comments";

export interface AddCommentDeps extends CanWriteDeps, IdempotentWriteDeps {
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
  /** What the author wants done with the comment (ADR-0064 Decision 8).
   *  Optional — the domain defaults an absent intent to `note`. */
  readonly intent?: Intent;
  /** The client's explicit `Idempotency-Key` header (ADR-0039), when sent. */
  readonly idempotencyKey?: string;
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
    intent: input.intent,
    createdAt: deps.clock.now(),
  });
  if (!emission.ok) return emission;

  // Idempotency (ADR-0039): a retried create replays the ORIGINAL comment
  // resource instead of posting a duplicate.
  const idem = await beginIdempotentWrite(deps, {
    actingUserId: actor.userId,
    route: ROUTE,
    key: input.idempotencyKey,
    fingerprint: [
      input.slug,
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
        action: "comment.added",
        orgId: actor.orgId,
        actorUserId: actor.userId,
        targetType: "comment",
        targetId: emission.value.comment.id,
        meta: { reportId: report.value.id },
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
