// Runs the shared ReportRepository contract against InMemoryReportRepository.
// The same suite also runs against DrizzleReportRepository on pglite from
// packages/adapters/src/report-repository.contract.test.ts (ADR-0046) — any
// divergence between the two fails in exactly one of the two runs.
import { createReport, folderId, makeSlug, orgId, reportId, userId, versionId } from "arp-domain";
import { InMemoryReportRepository } from "../in-memory";
import {
  describeReportRepositoryContract,
  type ReportFixtureOverrides,
} from "./report-repository.contract";

const ORG_ID = orgId("contract-org");
const FOLDER_ID = folderId("contract-folder");
const UPLOADER_ID = userId("contract-user");

function slugFor(n: number): string {
  return `rc${n.toString().padStart(8, "0")}`; // 10 chars, nanoid alphabet
}

// Zero-padded so lexicographic (string) compare == creation order — the fake's
// keysetPage sorts on plain `id` string compare, mirroring the real adapter's
// `ORDER BY id DESC` over a UUIDv7 (which is also lexicographically time-ordered).
// One shared counter for every version id (both a report's v1 from makeReport
// and any later nextVersionId() call) so cross-version ordering is consistent.
let versionSeq = 0;
function versionIdFixture(): ReturnType<typeof versionId> {
  versionSeq += 1;
  return versionId(`v${versionSeq.toString().padStart(10, "0")}`);
}

describeReportRepositoryContract("in-memory", async () => {
  const repo = new InMemoryReportRepository();
  let seq = 0;

  return {
    repo,
    orgId: ORG_ID,
    nextVersionId: versionIdFixture,
    makeReport(overrides: ReportFixtureOverrides = {}) {
      seq += 1;
      const slugStr = overrides.slug ?? slugFor(seq);
      const slug = makeSlug(slugStr);
      if (!slug.ok) throw new Error(`bad contract-test slug: ${slugStr}`);
      return createReport({
        id: overrides.id ?? reportId(`contract-report-${seq}`),
        orgId: ORG_ID,
        folderId: FOLDER_ID,
        slug: slug.value,
        title: overrides.title ?? `Report ${seq}`,
        versionId: versionIdFixture(),
        contentHash: "a".repeat(64),
        uploadedBy: UPLOADER_ID,
        manifest: { entryDocument: "index.html", files: ["index.html"] },
        sizeBytes: 11,
      }).report;
    },
    async teardown() {},
  };
});
