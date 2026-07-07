// DrizzleReportRepository — persists the Report aggregate across the `reports`
// + `report_versions` tables (ADR-0020 repository pattern). Row<->domain
// mapping is factored into pure functions so it can be unit-tested without a DB;
// the actual queries are integration-tested against the Neon branch (ADR-0019).
import type {
  ReportPage,
  ReportRepository,
  ReportSearchQuery,
  ReportSummary,
} from "arp-application";
import { acls, reports, reportVersions } from "arp-db/schema";
import {
  type Acl,
  type AppError,
  DEFAULT_ACCESS_TTL_SECONDS,
  DEFAULT_ACL,
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
import { and, asc, desc, eq, gt, ilike, isNull, lt, or, sql } from "drizzle-orm";
import type { Db, DbContext } from "./client";

type ReportRow = typeof reports.$inferSelect;
type VersionRow = typeof reportVersions.$inferSelect;

// ── Pure mappers ────────────────────────────────────────────────────────────
// Module-private: no consumer outside this file (they used to be exported
// solely so report-repository.test.ts could reach past the ReportRepository
// interface and assert on mapper output / generated SQL strings — that test
// was deleted; behavior is covered through the public interface by
// report-repository.integration.test.ts and the ReportRepository contract
// suite, run against this adapter on pglite, ADR-0046).

function reportToRow(r: Report): typeof reports.$inferInsert {
  return {
    id: r.id,
    orgId: r.orgId,
    ownerId: r.ownerId,
    folderId: r.folderId,
    slug: r.slug,
    title: r.title,
    liveVersionId: r.liveVersionId,
    deletedAt: r.deletedAt === null ? null : new Date(r.deletedAt),
  };
}

function versionToRow(reportRowId: string, v: ReportVersion): typeof reportVersions.$inferInsert {
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

function rowToVersion(row: VersionRow): ReportVersion {
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

/** Map the 1:1 `acls` row to the domain `Acl` (ADR-0056). No row ⇒ `private` (the
 *  private-by-default; sharing is an explicit opt-in). */
function rowToAcl(row: typeof acls.$inferSelect | undefined): Acl {
  if (!row) return DEFAULT_ACL;
  switch (row.mode) {
    case "private":
      return { mode: "private" };
    case "public":
      return { mode: "public" };
    case "password":
      return { mode: "password", passwordHash: row.passwordHash ?? "" };
    case "allowlist":
      return {
        mode: "allowlist",
        allowedEmails: (row.allowedEmails as string[] | null) ?? [],
        accessTtlSeconds: row.accessTtlSeconds ?? DEFAULT_ACCESS_TTL_SECONDS,
      };
    case "org":
      return { mode: "org" };
    default:
      return DEFAULT_ACL; // fail closed on an unexpected mode
  }
}

function rowsToReport(report: ReportRow, versions: readonly VersionRow[], acl: Acl): Report {
  return {
    id: reportId(report.id),
    orgId: orgId(report.orgId),
    ownerId: userId(report.ownerId),
    folderId: folderId(report.folderId),
    slug: report.slug as Slug,
    title: report.title,
    liveVersionId: (report.liveVersionId ?? null) as VersionId | null,
    versions: versions.map(rowToVersion),
    deletedAt: report.deletedAt === null ? null : report.deletedAt.getTime(),
    acl,
  };
}

// scan_status is the only mutable version field post-insert (pending → verdict),
// so a conflict must refresh it from the inserted row, not no-op.
function upsertVersions(db: Db, rows: (typeof reportVersions.$inferInsert)[]) {
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
          id: reports.id,
          slug: reports.slug,
          title: reports.title,
          liveVersionId: reports.liveVersionId,
          folderId: reports.folderId,
        })
        .from(reports)
        .where(and(eq(reports.orgId, org), isNull(reports.deletedAt)))
        .orderBy(desc(reports.updatedAt));
      return ok(
        rows.map((r) => ({
          id: reportId(r.id),
          slug: r.slug as Slug,
          title: r.title,
          isPublished: r.liveVersionId !== null,
          folderId: folderId(r.folderId),
        })),
      );
    } catch (e) {
      return err2("listReportsByOrg", e);
    }
  }

  async searchByOrg(org: OrgId, q: ReportSearchQuery): Promise<Result<ReportPage, AppError>> {
    // Org-scoped cursor pagination (ADR-0053): keyset on the report id (UUIDv7),
    // DESC = newest-created first. `starting_after` pages forward (id < cursor);
    // `ending_before` pages back (id > cursor, fetched ASC then reversed). Optional
    // folder filter + literal title/slug substring search.
    try {
      const db = this.ctx.current();
      const filters = [eq(reports.orgId, org), isNull(reports.deletedAt)];
      if (q.folderId) filters.push(eq(reports.folderId, q.folderId));
      const needle = q.query?.trim();
      if (needle) {
        // Escape LIKE metacharacters so the query is matched as a literal substring
        // (Postgres ILIKE's default escape is `\`). Without this, `%`/`_`/`\` keep
        // their wildcard meaning and the adapter would diverge from the in-memory
        // fake's literal `.includes()`.
        const escaped = needle.replace(/[\\%_]/g, (c) => `\\${c}`);
        const like = `%${escaped}%`;
        const match = or(ilike(reports.title, like), ilike(reports.slug, like));
        if (match) filters.push(match);
      }
      const back = q.endingBefore !== undefined;
      if (q.startingAfter) filters.push(lt(reports.id, q.startingAfter));
      if (q.endingBefore) filters.push(gt(reports.id, q.endingBefore));

      const rows = await db
        .select({
          id: reports.id,
          slug: reports.slug,
          title: reports.title,
          liveVersionId: reports.liveVersionId,
          folderId: reports.folderId,
        })
        .from(reports)
        .where(and(...filters))
        .orderBy(back ? asc(reports.id) : desc(reports.id))
        .limit(q.limit + 1); // +1 to detect has_more

      const hasMore = rows.length > q.limit;
      const slice = rows.slice(0, q.limit);
      const page = back ? slice.reverse() : slice; // always present newest-first
      return ok({
        items: page.map((r) => ({
          id: reportId(r.id),
          slug: r.slug as Slug,
          title: r.title,
          isPublished: r.liveVersionId !== null,
          folderId: folderId(r.folderId),
        })),
        hasMore,
      });
    } catch (e) {
      return err2("searchReportsByOrg", e);
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
      // The Acl is an aggregate member (ADR-0056) — loaded with the report; no row = private.
      const [aclRow] = await db.select().from(acls).where(eq(acls.reportId, row.id)).limit(1);
      return ok(rowsToReport(row, versions, rowToAcl(aclRow)));
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
            // folder_id is mutable post-create (moveReport, ADR-0036). A re-upload
            // saves the aggregate's existing folder, so this is a no-op there.
            folderId: report.folderId,
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

  async softDelete(id: ReportId): Promise<Result<void, AppError>> {
    try {
      const db = this.ctx.current();
      await db
        .update(reports)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(reports.id, id), isNull(reports.deletedAt)));
      return ok(undefined);
    } catch (e) {
      return err2("softDeleteReport", e);
    }
  }

  async setAcl(id: ReportId, acl: Acl): Promise<Result<void, AppError>> {
    try {
      // Mode-specific columns; null out the ones the mode doesn't use (ADR-0056).
      const passwordHash = acl.mode === "password" ? acl.passwordHash : null;
      const allowedEmails = acl.mode === "allowlist" ? [...acl.allowedEmails] : null;
      const accessTtlSeconds = acl.mode === "allowlist" ? acl.accessTtlSeconds : null;
      await this.ctx
        .current()
        .insert(acls)
        .values({ reportId: id, mode: acl.mode, passwordHash, allowedEmails, accessTtlSeconds })
        .onConflictDoUpdate({
          target: acls.reportId,
          set: {
            mode: acl.mode,
            passwordHash,
            allowedEmails,
            accessTtlSeconds,
            updatedAt: new Date(),
          },
        });
      return ok(undefined);
    } catch (e) {
      return err2("setAcl", e);
    }
  }
}

function err2(op: string, e: unknown): Result<never, AppError> {
  return {
    ok: false,
    error: { kind: "Unexpected", message: `${op}: ${e instanceof Error ? e.message : String(e)}` },
  };
}
