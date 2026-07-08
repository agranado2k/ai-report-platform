// listComments — the comment-thread read surface for one Report (ADR-0064 §4:
// "no anonymous read of comments either" — this is an AUTHENTICATED, org-scoped
// read, never reachable from the public viewer route). Auth mirrors
// listReportVersions (org-scoped loadOrgReport, ADR-0059 §3) — NOT getReport's
// now-real loadReadableReport carve-out (getReport gained the cross-org
// write-grantee metadata carve-out in PR #150; listReportVersions has NOT been
// updated to match, per its own comment — "mirror it here in the same change"
// once it lands there). JUDGMENT CALL / KNOWN GAP, flagged rather than fixed:
// a cross-org write-grantee who can author a comment on a report (canWrite
// covers grants, PR #150) may not be able to list the thread they're part of
// via this endpoint — the same parity gap already open between getReport and
// listReportVersions, now visible here too. Fix both listReportVersions and
// listComments together if/when that carve-out is prioritized. Returns both
// roots and replies, newest-created first (ADR-0053 cursor pagination) — the
// caller threads them into Threads client-side via `parentCommentId`.
import type { AppError, CommentId, OrgId, Result, Slug } from "arp-domain";
import { loadOrgReport } from "../load-owned";
import type { CommentPage, CommentRepository, ReportRepository } from "../ports";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface ListCommentsDeps {
  readonly reports: ReportRepository;
  readonly comments: CommentRepository;
}
export interface ListCommentsActor {
  readonly orgId: OrgId;
}
export interface ListCommentsInput {
  readonly slug: Slug;
  readonly limit?: number;
  readonly startingAfter?: CommentId;
  readonly endingBefore?: CommentId;
}

export async function listComments(
  deps: ListCommentsDeps,
  actor: ListCommentsActor,
  input: ListCommentsInput,
): Promise<Result<CommentPage, AppError>> {
  const org = await loadOrgReport(deps.reports, actor, input.slug);
  if (!org.ok) return org;

  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Math.floor(input.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT),
  );
  return deps.comments.listByReport(org.value.id, {
    limit,
    startingAfter: input.startingAfter,
    endingBefore: input.endingBefore,
  });
}
