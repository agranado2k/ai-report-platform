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

describeReportRepositoryContract("in-memory", async () => {
  const repo = new InMemoryReportRepository();
  let seq = 0;

  return {
    repo,
    orgId: ORG_ID,
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
        versionId: versionId(`contract-version-${seq}`),
        contentHash: "a".repeat(64),
        uploadedBy: UPLOADER_ID,
        manifest: { entryDocument: "index.html", files: ["index.html"] },
        sizeBytes: 11,
      }).report;
    },
    async teardown() {},
  };
});
