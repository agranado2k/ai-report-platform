import {
  createReport,
  err,
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
import type { AuditLogger } from "../ports";
import {
  InMemoryAuditLogger,
  InMemoryReportRepository,
  PassThroughUnitOfWork,
} from "../testing/in-memory";
import { type DeleteReportDeps, deleteReport } from "./delete-report";

const orgA = orgId("00000000-0000-7000-8000-0000000000a1");
const owner = userId("00000000-0000-7000-8000-0000000000d1");
const otherUser = userId("00000000-0000-7000-8000-0000000000d2");
const ownerActor = { orgId: orgA, userId: owner };

function makeDeps() {
  return {
    reports: new InMemoryReportRepository(),
    audit: new InMemoryAuditLogger(),
    uow: new PassThroughUnitOfWork(),
  };
}

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
    title: "A report",
    versionId: versionId("00000000-0000-7000-8000-0000000000e1"),
    contentHash: "h".repeat(64),
    uploadedBy: userId("00000000-0000-7000-8000-0000000000d1"),
    manifest: { entryDocument: "index.html", files: ["index.html"] },
    sizeBytes: 1,
  }).report;
}

describe("deleteReport use case", () => {
  it("soft-deletes a report (excluded from listByOrg)", async () => {
    const deps = makeDeps();
    await deps.reports.save(report(orgA, "aaaaaaaaaa"));
    const r = await deleteReport(deps, ownerActor, { slug: slug("aaaaaaaaaa") });
    expect(r.ok).toBe(true);
    const list = await deps.reports.listByOrg(orgA);
    expect(list.ok && list.value.some((s) => s.slug === "aaaaaaaaaa")).toBe(false);
  });

  it("rejects a non-owner (even same-org) with NotAllowed (ADR-0059: delete is owner-only)", async () => {
    const deps = makeDeps();
    await deps.reports.save(report(orgA, "bbbbbbbbbb"));
    const r = await deleteReport(
      deps,
      { orgId: orgA, userId: otherUser },
      {
        slug: slug("bbbbbbbbbb"),
      },
    );
    expect(!r.ok && r.error).toEqual({ kind: "NotAllowed", message: "you do not own this report" });
  });

  it("rejects an unknown report with NotFound", async () => {
    const deps = makeDeps();
    const r = await deleteReport(deps, ownerActor, { slug: slug("cccccccccc") });
    expect(!r.ok && r.error.kind).toBe("NotFound");
  });

  it("rejects an already-deleted report with NotFound", async () => {
    const deps = makeDeps();
    await deps.reports.save(report(orgA, "dddddddddd"));
    await deleteReport(deps, ownerActor, { slug: slug("dddddddddd") });
    const again = await deleteReport(deps, ownerActor, { slug: slug("dddddddddd") });
    expect(!again.ok && again.error.kind).toBe("NotFound");
  });

  it("records a report.deleted audit entry alongside the soft-delete (ADR-0070)", async () => {
    const deps = makeDeps();
    const toDelete = report(orgA, "eeeeeeeeee");
    await deps.reports.save(toDelete);
    const r = await deleteReport(deps, ownerActor, { slug: slug("eeeeeeeeee") });
    expect(r.ok).toBe(true);
    expect(deps.audit.recorded()).toContainEqual({
      action: "report.deleted",
      orgId: orgA,
      actorUserId: owner,
      targetType: "report",
      targetId: toDelete.id,
    });
  });

  it("ATOMICITY: when audit.record fails inside uow.run, the use case returns that error", async () => {
    const failingAudit: AuditLogger = {
      record: async () => err({ kind: "Unexpected", message: "audit sink down" }),
    };
    const deps: DeleteReportDeps = {
      reports: new InMemoryReportRepository(),
      audit: failingAudit,
      uow: new PassThroughUnitOfWork(),
    };
    await deps.reports.save(report(orgA, "ffffffffff"));

    const r = await deleteReport(deps, ownerActor, { slug: slug("ffffffffff") });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toBe("audit sink down");

    // NOTE: PassThroughUnitOfWork is a non-transactional fake — it can't prove
    // the softDelete write was actually rolled back (InMemoryReportRepository
    // mutates its map directly, with no undo). The real rollback guarantee is
    // proven against real Postgres in
    // packages/adapters/src/delete-report.integration.test.ts, which wires
    // deleteReport with DrizzleUnitOfWork + DrizzleReportRepository + a
    // failing AuditLogger and asserts the row's `deleted_at` stayed null.
  });
});
