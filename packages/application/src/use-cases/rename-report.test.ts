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

describe("renameReport idempotency (ADR-0039)", () => {
  it("re-applies on an identical KEYLESS retry — no derived-key replay (#233)", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(report(orgA, "ffffffffff"));
    const deps = { reports, ...writeDeps() };
    const input = { slug: slug("ffffffffff"), title: "New Title" };

    const first = await renameReport(deps, ownerActor, input);
    const second = await renameReport(deps, ownerActor, input);
    expect(first.ok && first.value.title).toBe("New Title");
    expect(second.ok && second.value.title).toBe("New Title");
    expect(second.ok && second.value.slug).toBe("ffffffffff");
    // #233: was 1, when the derived-key fallback replayed instead of
    // re-applying. The retry now really runs — same end state (these are
    // naturally idempotent), one more audit row. An explicit
    // Idempotency-Key still claims and replays exactly as before.
    expect(deps.audit.recorded().length).toBe(2);
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
