import {
  type AppError,
  addVersion,
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

async function resolve(
  report?: Report,
  requestedVersionNo?: number,
): Promise<Result<ViewOutcome, AppError>> {
  const repo = new InMemoryReportRepository();
  if (report) await repo.save(report);
  const slug = makeSlug(SLUG);
  if (!slug.ok) throw new Error("test slug invalid");
  return resolveViewableReport(slug.value, repo, requestedVersionNo);
}

// A 4-version report for the ?v=N matrix below: v1 clean+live, v2 pending,
// v3 flagged, v4 blocked. Built with distinct VersionIds so each ordinal's
// scan_status can be set independently via applyScanResult.
const VID2 = versionId("00000000-0000-4000-8000-0000000000b2");
const VID3 = versionId("00000000-0000-4000-8000-0000000000b3");
const VID4 = versionId("00000000-0000-4000-8000-0000000000b4");

function buildMultiVersionReport(opts: { deleted?: boolean } = {}): Report {
  const slug = makeSlug(SLUG);
  if (!slug.ok) throw new Error("test slug invalid");
  const { report: created } = createReport({
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
  let report = applyScanResult(created, VID, "clean").report; // v1 clean → live

  const nextVersion = (id: typeof VID2) => ({
    versionId: id,
    contentHash: "b".repeat(64),
    uploadedBy: userId("00000000-0000-4000-8000-000000000002"),
    manifest: { entryDocument: "index.html", files: ["index.html"] },
    sizeBytes: 11,
  });

  const withV2 = addVersion(report, nextVersion(VID2));
  if (!withV2.ok) throw new Error("addVersion v2 failed");
  report = withV2.value.report; // v2 left pending — no applyScanResult call

  const withV3 = addVersion(report, nextVersion(VID3));
  if (!withV3.ok) throw new Error("addVersion v3 failed");
  report = applyScanResult(withV3.value.report, VID3, "flagged").report; // v3 flagged

  const withV4 = addVersion(report, nextVersion(VID4));
  if (!withV4.ok) throw new Error("addVersion v4 failed");
  report = applyScanResult(withV4.value.report, VID4, "blocked").report; // v4 blocked

  if (opts.deleted) report = { ...report, deletedAt: 1000 };
  return report;
}

describe("resolveViewableReport (ADR-0038 viewer gate)", () => {
  it("serves the clean live version", async () => {
    const r = await resolve(buildReport({ verdict: "clean" }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.kind).toBe("serve");
      if (r.value.kind === "serve") expect(r.value.version.id).toBe(VID);
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
      async listVersions() {
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

// ADR-0038 §3: "`?v=N` passes through the same ACL + the same scan-status state
// machine as the live URL." These tests exercise the requested-ordinal branch of
// resolveViewableReport in isolation from the ACL gate (which lives in
// resolve-access.ts and is applied by the route AFTER this outcome, identically
// regardless of whether the outcome came from the live path or ?v=N — the two
// paths share the same `report.acl`, so there is no separate gate to bypass).
describe("resolveViewableReport — ?v=N version-by-ordinal (ADR-0038 §3)", () => {
  it("serves a clean non-live version by ordinal (v1, the live version)", async () => {
    const r = await resolve(buildMultiVersionReport(), 1);
    expect(r.ok && r.value.kind).toBe("serve");
    if (r.ok && r.value.kind === "serve") expect(r.value.version.id).toBe(VID);
  });

  it("returns the 'scanning' holding page for a pending ordinal (v2) — mirrors the live-path row, not a 404", async () => {
    const r = await resolve(buildMultiVersionReport(), 2);
    expect(r.ok && r.value.kind).toBe("scanning");
  });

  it("returns 451 ('flagged') for a flagged ordinal (v3) — same reason-opaque code as the live path", async () => {
    const r = await resolve(buildMultiVersionReport(), 3);
    expect(r.ok && r.value.kind).toBe("flagged");
  });

  it("returns 'notfound' (404) for a blocked ordinal (v4) — indistinguishable from unknown", async () => {
    const r = await resolve(buildMultiVersionReport(), 4);
    expect(r.ok && r.value.kind).toBe("notfound");
  });

  it("returns 'notfound' (404) for an out-of-range ordinal — doesn't leak the version count", async () => {
    const r = await resolve(buildMultiVersionReport(), 99);
    expect(r.ok && r.value.kind).toBe("notfound");
  });

  it("returns 'notfound' (404) for ordinal 0", async () => {
    const r = await resolve(buildMultiVersionReport(), 0);
    expect(r.ok && r.value.kind).toBe("notfound");
  });

  it("returns 'notfound' (404) for a negative ordinal", async () => {
    const r = await resolve(buildMultiVersionReport(), -1);
    expect(r.ok && r.value.kind).toBe("notfound");
  });

  it("returns 'notfound' (404) for a non-integer ordinal passed through (defense-in-depth; the route itself never forwards one)", async () => {
    const r = await resolve(buildMultiVersionReport(), 1.5);
    expect(r.ok && r.value.kind).toBe("notfound");
  });

  it("returns 'deleted' (410) for a taken-down report at ANY ordinal, including a clean one", async () => {
    const r = await resolve(buildMultiVersionReport({ deleted: true }), 1);
    expect(r.ok && r.value.kind).toBe("deleted");
  });

  it("is unaffected by requestedVersionNo when absent — still resolves the live version (unchanged default)", async () => {
    const r = await resolve(buildMultiVersionReport());
    expect(r.ok && r.value.kind).toBe("serve");
    if (r.ok && r.value.kind === "serve") expect(r.value.version.id).toBe(VID);
  });
});
