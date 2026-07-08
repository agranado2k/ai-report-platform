// Runs the shared CommentRepository contract against InMemoryCommentRepository.
// The same suite also runs against DrizzleCommentRepository on pglite from
// packages/adapters/src/comment-repository.contract.test.ts (ADR-0046).
import { type Comment, commentId, reportId, userId, versionId } from "arp-domain";
import { InMemoryCommentRepository } from "../in-memory";
import { describeCommentRepositoryContract } from "./comment-repository.contract";

const REPORT_ID = reportId("00000000-0000-4000-8000-0000000000a1");
const OTHER_REPORT_ID = reportId("00000000-0000-4000-8000-0000000000a2");
const AUTHOR_ID = userId("00000000-0000-4000-8000-0000000000b1");
const VERSION_ID = versionId("00000000-0000-4000-8000-0000000000c1");

describeCommentRepositoryContract("in-memory", async () => {
  const repo = new InMemoryCommentRepository();
  let seq = 0;

  return {
    repo,
    reportId: REPORT_ID,
    otherReportId: OTHER_REPORT_ID,
    authorUserId: AUTHOR_ID,
    makeComment(overrides = {}): Comment {
      seq += 1;
      return {
        id:
          overrides.id ??
          commentId(`00000000-0000-4000-8000-${seq.toString(16).padStart(12, "0")}`),
        reportId: overrides.reportId ?? REPORT_ID,
        authorUserId: overrides.authorUserId ?? AUTHOR_ID,
        body: overrides.body ?? `Comment ${seq}`,
        anchor: { versionPinned: { versionId: VERSION_ID, textQuote: `quote ${seq}` } },
        parentCommentId: overrides.parentCommentId ?? null,
        resolvedAt: null,
        createdAt: seq,
      };
    },
    async teardown() {},
  };
});
