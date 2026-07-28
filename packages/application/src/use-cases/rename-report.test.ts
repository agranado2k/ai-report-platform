import {
  createReport,
  folderId,
  makeSlug,
  orgId,
  type Report,
  reportId,
  type Slug,
  userId,
  versionId,
} from "arp-domain";
import { describe, expect, it } from "vitest";
import {
  InMemoryAuditLogger,
  InMemoryIdentityStore,
  InMemoryReportRepository,
  InMemoryWriteGrantStore,
  idempotencyTestDeps,
  PassThroughUnitOfWork,
} from "../testing/in-memory";
import { renameReport } from "./rename-report";

const writeDeps = () => ({
  grants: new InMemoryWriteGrantStore(),
  identities: new InMemoryIdentityStore(),
  audit: new InMemoryAuditLogger(),
  uow: new PassThroughUnitOfWork(),
  ...idempotencyTestDeps(),
});

const orgA = orgId("00000000-0000-7000-8000-0000000000a1");
const owner = userId("00000000-0000-7000-8000-0000000000d1");
const otherUser = userId("00000000-0000-7000-8000-0000000000d2");
const ownerActor = { orgId: orgA, userId: owner };

function slug(s: string): Slug {
  const r = makeSlug(s);
  if (!r.ok) throw new Error("bad slug");
  return r.value;
}
function report(org: typeof orgA, slugStr: string): Report {
  return createReport({
    id: reportId(`00000000-0000-7000-8000-0000000000${slugStr.slice(0, 2)}`),
    orgId: org,
    folderId: folderId("00000000-0000-7000-8000-0000000000a0"),
    slug: slug(slugStr),
    title: "Old Title",
    versionId: versionId("00000000-0000-7000-8000-0000000000e1"),
    contentHash: "h".repeat(64),
    uploadedBy: userId("00000000-0000-7000-8000-0000000000d1"),
    manifest: { entryDocument: "index.html", files: ["index.html"] },
    sizeBytes: 1,
  }).report;
}

describe("renameReport use case", () => {
  it("renames a report in the same org and persists the title", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(report(orgA, "aaaaaaaaaa"));
    const r = await renameReport({ reports, ...writeDeps() }, ownerActor, {
      slug: slug("aaaaaaaaaa"),
      title: "New Title",
    });
    expect(r.ok && r.value.title).toBe("New Title");
    const reloaded = await reports.findBySlug(slug("aaaaaaaaaa"));
    expect(reloaded.ok && reloaded.value?.title).toBe("New Title");
  });

  it("rejects a non-owner without a write grant with NotAllowed (canWrite, ADR-0059/0060)", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(report(orgA, "bbbbbbbbbb"));
    const r = await renameReport(
      { reports, ...writeDeps() },
      { orgId: orgA, userId: otherUser },
      { slug: slug("bbbbbbbbbb"), title: "X" },
    );
    expect(!r.ok && r.error).toEqual({
      kind: "NotAllowed",
      message: "you do not have write access to this report",
    });
  });

  it("rejects an unknown report with NotFound", async () => {
    const reports = new InMemoryReportRepository();
    const r = await renameReport({ reports, ...writeDeps() }, ownerActor, {
      slug: slug("cccccccccc"),
      title: "X",
    });
    expect(!r.ok && r.error.kind).toBe("NotFound");
  });

  it("rejects an empty title with ValidationError", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(report(orgA, "dddddddddd"));
    const r = await renameReport({ reports, ...writeDeps() }, ownerActor, {
      slug: slug("dddddddddd"),
      title: "  ",
    });
    expect(!r.ok && r.error.kind).toBe("ValidationError");
  });

  it("records a report.renamed audit entry alongside the rename (ADR-0070)", async () => {
    const reports = new InMemoryReportRepository();
    const toRename = report(orgA, "eeeeeeeeee");
    await reports.save(toRename);
    const deps = { reports, ...writeDeps() };
    const r = await renameReport(deps, ownerActor, {
      slug: slug("eeeeeeeeee"),
      title: "New Title",
    });
    expect(r.ok).toBe(true);
    expect(deps.audit.recorded()).toContainEqual({
      action: "report.renamed",
      orgId: orgA,
      actorUserId: owner,
      targetType: "report",
      targetId: toRename.id,
      meta: { from: "Old Title", to: "New Title" },
    });
  });
});

describe("renameReport idempotency (ADR-0039)", () => {
  it("replays the recorded response on an identical retry — one mutation, one audit row", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(report(orgA, "ffffffffff"));
    const deps = { reports, ...writeDeps() };
    const input = { slug: slug("ffffffffff"), title: "New Title" };

    const first = await renameReport(deps, ownerActor, input);
    const second = await renameReport(deps, ownerActor, input);
    expect(first.ok && first.value.title).toBe("New Title");
    expect(second.ok && second.value.title).toBe("New Title");
    expect(second.ok && second.value.slug).toBe("ffffffffff");
    expect(deps.audit.recorded().length).toBe(1); // the replay never re-audited
  });

  it("rejects an explicit Idempotency-Key reused with a different payload (422)", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(report(orgA, "gggggggggg"));
    const deps = { reports, ...writeDeps() };

    const first = await renameReport(deps, ownerActor, {
      slug: slug("gggggggggg"),
      title: "One",
      idempotencyKey: "k1",
    });
    expect(first.ok).toBe(true);
    const second = await renameReport(deps, ownerActor, {
      slug: slug("gggggggggg"),
      title: "Two",
      idempotencyKey: "k1",
    });
    expect(!second.ok && second.error.kind).toBe("IdempotencyKeyReuseDifferentBody");
  });

  it("maps a concurrent in-flight duplicate to IdempotencyInFlight (409)", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(report(orgA, "hhhhhhhhhh"));
    const deps = { reports, ...writeDeps() };
    // Claim the key but never complete it (simulates an in-flight request).
    await deps.idempotency.begin(
      {
        actingUserId: owner,
        route: "PATCH /api/v1/reports/{slug}",
        key: "inflight",
      },
      deps.keyHasher.hash("hhhhhhhhhh\nX"),
    );
    const r = await renameReport(deps, ownerActor, {
      slug: slug("hhhhhhhhhh"),
      title: "X",
      idempotencyKey: "inflight",
    });
    expect(!r.ok && r.error.kind).toBe("IdempotencyInFlight");
  });
});
