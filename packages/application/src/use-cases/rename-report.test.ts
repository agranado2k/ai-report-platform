import type { OrgId, Report } from "arp-domain";
import { describe, expect, it } from "vitest";
import {
  ACTORS,
  ownerActor,
  report as reportFixture,
  slug,
  makeWriteSeamDeps as writeDeps,
} from "../testing/fixtures";
import { InMemoryReportRepository } from "../testing/in-memory";
import { renameReport } from "./rename-report";

const { orgA, owner, otherUser } = ACTORS;

function report(org: OrgId, slugStr: string): Report {
  return reportFixture(org, slugStr, { title: "Old Title" });
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
