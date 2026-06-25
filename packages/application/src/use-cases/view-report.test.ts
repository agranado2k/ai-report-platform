import {
  type AppError,
  applyScanResult,
  createReport,
  err,
  folderId,
  makeSlug,
  orgId,
  type Report,
  type Result,
  reportId,
  type TerminalScanStatus,
  userId,
  versionId,
} from "arp-domain";
import { describe, expect, it } from "vitest";
import type { ReportRepository } from "../ports";
import { InMemoryReportRepository } from "../testing/in-memory";
import { resolveViewableReport, type ViewOutcome } from "./view-report";

const RID = reportId("00000000-0000-4000-8000-0000000000a1");
const VID = versionId("00000000-0000-4000-8000-0000000000b1");
const SLUG = "abcde12345";

function buildReport(opts: { verdict?: TerminalScanStatus; deleted?: boolean } = {}): Report {
  const slug = makeSlug(SLUG);
  if (!slug.ok) throw new Error("test slug invalid");
  const { report } = createReport({
    id: RID,
    orgId: orgId("00000000-0000-4000-8000-000000000001"),
    folderId: folderId("00000000-0000-4000-8000-000000000003"),
    slug: slug.value,
    title: "Report",
    versionId: VID,
    contentHash: "a".repeat(64),
    uploadedBy: userId("00000000-0000-4000-8000-000000000002"),
    manifest: { entryDocument: "index.html", files: ["index.html"] },
    sizeBytes: 11,
  });
  let r = opts.verdict ? applyScanResult(report, VID, opts.verdict).report : report;
  if (opts.deleted) r = { ...r, deletedAt: 1000 };
  return r;
}

async function resolve(report?: Report): Promise<Result<ViewOutcome, AppError>> {
  const repo = new InMemoryReportRepository();
  if (report) await repo.save(report);
  const slug = makeSlug(SLUG);
  if (!slug.ok) throw new Error("test slug invalid");
  return resolveViewableReport(slug.value, repo);
}

describe("resolveViewableReport (ADR-0038 viewer gate)", () => {
  it("serves the clean live version", async () => {
    const r = await resolve(buildReport({ verdict: "clean" }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.kind).toBe("serve");
      if (r.value.kind === "serve") expect(r.value.liveVersion.id).toBe(VID);
    }
  });

  it("returns 'scanning' when the newest version is still pending (no live)", async () => {
    const r = await resolve(buildReport());
    expect(r.ok && r.value.kind).toBe("scanning");
  });

  it("returns 'flagged' for a flagged version with no live", async () => {
    const r = await resolve(buildReport({ verdict: "flagged" }));
    expect(r.ok && r.value.kind).toBe("flagged");
  });

  it("returns 'notfound' for a blocked version (reason-opaque)", async () => {
    const r = await resolve(buildReport({ verdict: "blocked" }));
    expect(r.ok && r.value.kind).toBe("notfound");
  });

  it("returns 'deleted' for a taken-down report, even if it had a clean live version", async () => {
    const r = await resolve(buildReport({ verdict: "clean", deleted: true }));
    expect(r.ok && r.value.kind).toBe("deleted");
  });

  it("refuses to serve if liveVersionId points at a non-clean version (defense-in-depth)", async () => {
    // A data-integrity violation of the ADR-0037 invariant: live is set but the
    // resolved version isn't clean. The gate must still refuse (reason-opaque).
    const clean = buildReport({ verdict: "clean" });
    const tampered: Report = {
      ...clean,
      versions: clean.versions.map((v) => ({ ...v, scanStatus: "flagged" as const })),
    };
    const r = await resolve(tampered);
    expect(r.ok && r.value.kind).toBe("notfound");
  });

  it("returns 'notfound' for an unknown slug", async () => {
    const r = await resolve(); // empty repo
    expect(r.ok && r.value.kind).toBe("notfound");
  });

  it("propagates an infra lookup failure as an AppError (route → 500)", async () => {
    const failing: ReportRepository = {
      async findBySlug() {
        return err({ kind: "Unexpected", message: "db down" });
      },
      async findById() {
        return err({ kind: "Unexpected", message: "db down" });
      },
      async listByOrg() {
        return err({ kind: "Unexpected", message: "db down" });
      },
      async searchByOrg() {
        return err({ kind: "Unexpected", message: "db down" });
      },
      async save() {
        return err({ kind: "Unexpected", message: "db down" });
      },
      async softDelete() {
        return err({ kind: "Unexpected", message: "db down" });
      },
      async setAcl() {
        return err({ kind: "Unexpected", message: "db down" });
      },
    };
    const slug = makeSlug(SLUG);
    if (!slug.ok) throw new Error("test slug invalid");
    const r = await resolveViewableReport(slug.value, failing);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("Unexpected");
  });
});
