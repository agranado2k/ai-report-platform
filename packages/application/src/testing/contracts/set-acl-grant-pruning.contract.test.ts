// Runs the shared setAcl grant-pruning contract (issue #137, ADR-0056 "5e")
// against the in-memory fakes. The same suite also runs against
// DrizzleGrantStore/DrizzleReportRepository on pglite from
// packages/adapters/src/set-acl-grant-pruning.contract.test.ts.
import { createReport, folderId, makeSlug, orgId, reportId, userId, versionId } from "arp-domain";
import { FakePasswordHasher, InMemoryGrantStore, InMemoryReportRepository } from "../in-memory";
import { describeSetAclGrantPruningContract } from "./set-acl-grant-pruning.contract";

const ORG = orgId("00000000-0000-7000-8000-0000000000a1");
const OWNER = userId("00000000-0000-7000-8000-0000000000d1");
const REPORT = reportId("00000000-0000-7000-8000-0000000000c1");

describeSetAclGrantPruningContract("in-memory", async () => {
  const reports = new InMemoryReportRepository();
  const slug = makeSlug("gp00000001");
  if (!slug.ok) throw new Error("bad contract-test slug");
  const { report } = createReport({
    id: REPORT,
    orgId: ORG,
    folderId: folderId("00000000-0000-7000-8000-0000000000f1"),
    slug: slug.value,
    title: "T",
    versionId: versionId("00000000-0000-7000-8000-0000000000e1"),
    contentHash: "h".repeat(64),
    uploadedBy: OWNER,
    manifest: { entryDocument: "index.html", files: ["index.html"] },
    sizeBytes: 1,
  });
  await reports.save(report);

  return {
    reports,
    // Real wall-clock time — mirrors the real adapter (grant-store.contract.test.ts).
    grants: new InMemoryGrantStore({ now: () => Date.now() }),
    hasher: new FakePasswordHasher(),
    orgId: ORG,
    userId: OWNER,
    reportId: REPORT,
    slug: slug.value,
    async teardown() {},
  };
});
