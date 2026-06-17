// DrizzleReportRepository — persists the Report aggregate across the `reports`
// + `report_versions` tables (ADR-0020 repository pattern). Row<->domain
// mapping is factored into pure functions so it can be unit-tested without a DB;
// the actual queries are integration-tested against the Neon branch (ADR-0019).
import type { ReportRepository, ReportSummary } from "arp-application";
import { reports, reportVersions } from "arp-db/schema";
import {
  type AppError,
  folderId,
  type OrgId,
  ok,
  orgId,
  type Report,
  type ReportId,
  type ReportVersion,
  type Result,
  reportId,
  type ScanStatus,
  type Slug,
  userId,
  type VersionId,
  type VersionManifest,
  versionId,
} from "arp-domain";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db, DbContext } from "./client";

type ReportRow = typeof reports.$inferSelect;
type VersionRow = typeof reportVersions.$inferSelect;

// ── Pure mappers ────────────────────────────────────────────────────────────

export function reportToRow(r: Report): typeof reports.$inferInsert {
  return {
    id: r.id,
    orgId: r.orgId,
    folderId: r.folderId,
    slug: r.slug,
    title: r.title,
    liveVersionId: r.liveVersionId,
    deletedAt: r.deletedAt === null ? null : new Date(r.deletedAt),
  };
}

export function versionToRow(
  reportRowId: string,
  v: ReportVersion,
): typeof reportVersions.$inferInsert {
  return {
    id: v.id,
    reportId: reportRowId,
    versionNo: v.versionNo,
    manifestJson: v.manifest,
    sizeBytes: v.sizeBytes,
    contentHash: v.contentHash,
    uploadedByUser: v.uploadedBy,
    scanStatus: v.scanStatus,
  };
}

export function rowToVersion(row: VersionRow): ReportVersion {
  return {
    id: versionId(row.id),
    versionNo: row.versionNo,
    contentHash: row.contentHash,
    uploadedBy: userId(row.uploadedByUser),
    scanStatus: row.scanStatus as ScanStatus,
    manifest: row.manifestJson as VersionManifest,
    sizeBytes: row.sizeBytes,
  };
}

export function rowsToReport(report: ReportRow, versions: readonly VersionRow[]): Report {
  return {
    id: reportId(report.id),
    orgId: orgId(report.orgId),
    folderId: folderId(report.folderId),
    slug: report.slug as Slug,
    title: report.title,
    liveVersionId: (report.liveVersionId ?? null) as VersionId | null,
    versions: versions.map(rowToVersion),
    deletedAt: report.deletedAt === null ? null : report.deletedAt.getTime(),
  };
}

// scan_status is the only mutable version field post-insert (pending → verdict),
// so a conflict must refresh it from the inserted row, not no-op.
export function upsertVersions(db: Db, rows: (typeof reportVersions.$inferInsert)[]) {
  return db
    .insert(reportVersions)
    .values(rows)
    .onConflictDoUpdate({
      target: reportVersions.id,
      set: { scanStatus: sql`excluded.scan_status` },
    });
}

// ── Adapter ───────────────────────────────────────────────────────────────--

export class DrizzleReportRepository implements ReportRepository {
  constructor(private readonly ctx: DbContext) {}

  async findBySlug(slug: Slug): Promise<Result<Report | null, AppError>> {
    return this.loadWhere(eq(reports.slug, slug));
  }

  async findById(id: ReportId): Promise<Result<Report | null, AppError>> {
    return this.loadWhere(eq(reports.id, id));
  }

  async listByOrg(org: OrgId): Promise<Result<readonly ReportSummary[], AppError>> {
    // Lean projection — no version rows/manifests loaded; newest reports first.
    // `isPublished` is derived from the live (clean) version pointer.
    try {
      const db = this.ctx.current();
      const rows = await db
        .select({
          slug: reports.slug,
          title: reports.title,
          liveVersionId: reports.liveVersionId,
        })
        .from(reports)
        .where(and(eq(reports.orgId, org), isNull(reports.deletedAt)))
        .orderBy(desc(reports.updatedAt));
      return ok(
        rows.map((r) => ({
          slug: r.slug as Slug,
          title: r.title,
          isPublished: r.liveVersionId !== null,
        })),
      );
    } catch (e) {
      return err2("listReportsByOrg", e);
    }
  }

  private async loadWhere(where: ReturnType<typeof eq>): Promise<Result<Report | null, AppError>> {
    try {
      const db = this.ctx.current();
      const [row] = await db.select().from(reports).where(where).limit(1);
      if (!row) return ok(null);
      const versions = await db
        .select()
        .from(reportVersions)
        .where(eq(reportVersions.reportId, row.id))
        .orderBy(asc(reportVersions.versionNo));
      return ok(rowsToReport(row, versions));
    } catch (e) {
      return err2("findReport", e);
    }
  }

  async save(report: Report): Promise<Result<void, AppError>> {
    try {
      const db = this.ctx.current();
      // Report row: insert, or update the mutable fields on a re-upload.
      await db
        .insert(reports)
        .values(reportToRow(report))
        .onConflictDoUpdate({
          target: reports.id,
          set: {
            liveVersionId: report.liveVersionId,
            title: report.title,
            deletedAt: report.deletedAt === null ? null : new Date(report.deletedAt),
            updatedAt: new Date(),
          },
        });
      // Versions: insert new ones; on conflict refresh the mutable scan_status.
      const rows = report.versions.map((v) => versionToRow(report.id, v));
      if (rows.length > 0) {
        await upsertVersions(db, rows);
      }
      return ok(undefined);
    } catch (e) {
      return err2("saveReport", e);
    }
  }
}

function err2(op: string, e: unknown): Result<never, AppError> {
  return {
    ok: false,
    error: { kind: "Unexpected", message: `${op}: ${e instanceof Error ? e.message : String(e)}` },
  };
}
