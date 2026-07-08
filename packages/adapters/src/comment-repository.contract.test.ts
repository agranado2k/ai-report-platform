// Runs the shared CommentRepository contract (arp-application/testing) against
// DrizzleCommentRepository on pglite (ADR-0046) — the same suite that runs
// against InMemoryCommentRepository in packages/application/src/testing/
// contracts/comment-repository.contract.test.ts. Exercises the REAL self-FK
// ON DELETE CASCADE (comments.parent_comment_id → comments, schema.ts's
// FK-policy note) that the in-memory fake only emulates.
import { describeCommentRepositoryContract } from "arp-application/testing";
import { commentId, reportId, versionId } from "arp-domain";
import { DrizzleCommentRepository } from "./comment-repository";
import { DrizzleReportRepository } from "./report-repository";
import { makeSampleReport, makeTestDb, seedIdentity } from "./testing/pglite";

function commentIdFixture(n: number) {
  return commentId(`40000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`);
}

describeCommentRepositoryContract("drizzle+pglite", async () => {
  const tdb = await makeTestDb();
  const ids = await seedIdentity(tdb.ctx);
  const reports = new DrizzleReportRepository(tdb.ctx);
  const repo = new DrizzleCommentRepository(tdb.ctx);

  // Two seeded reports — comments FK to `reports`, so a valid comment needs a
  // real report row. Distinct ids/versionIds (makeSampleReport's defaults would
  // otherwise collide on a second call) + distinct nanoid(10)-shaped slugs.
  const reportA = makeSampleReport({
    id: reportId("60000000-0000-4000-8000-00000000000a"),
    versionId: versionId("60000000-0000-4000-8000-00000000001a"),
    slug: "rccontrct0",
    title: "Report A",
  });
  const reportB = makeSampleReport({
    id: reportId("60000000-0000-4000-8000-00000000000b"),
    versionId: versionId("60000000-0000-4000-8000-00000000001b"),
    slug: "rccontrct1",
    title: "Report B",
  });
  await reports.save(reportA.report);
  await reports.save(reportB.report);

  let seq = 0;

  return {
    repo,
    reportId: reportA.report.id,
    otherReportId: reportB.report.id,
    authorUserId: ids.userId,
    makeComment(overrides = {}) {
      seq += 1;
      return {
        id: overrides.id ?? commentIdFixture(seq),
        reportId: overrides.reportId ?? reportA.report.id,
        authorUserId: overrides.authorUserId ?? ids.userId,
        body: overrides.body ?? `Comment ${seq}`,
        anchor: {
          versionPinned: {
            versionId: versionId(`50000000-0000-4000-8000-${seq.toString(16).padStart(12, "0")}`),
            textQuote: `quote ${seq}`,
          },
        },
        parentCommentId: overrides.parentCommentId ?? null,
        resolvedAt: null,
        createdAt: seq,
      };
    },
    async teardown() {
      await tdb.close();
    },
  };
});
