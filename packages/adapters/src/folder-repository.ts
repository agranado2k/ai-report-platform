// DrizzleFolderRepository — persists the Folder aggregate against the `folders`
// table (ADR-0020). Sibling-slug uniqueness is enforced by the DB
// (folders_org_parent_slug_uniq); a violation maps to a client-correctable
// ValidationError. Listing is visibility-scoped to the viewer (ADR-0076,
// mirroring DrizzleReportRepository's ADR-0075 predicate): a folder is listed
// iff the viewer owns it, it's legacy (owner_id NULL), its visibility is
// `org`, or a `folder_shares` row matches the viewer (userId OR normalized
// email — the ADR-0060 §2 dual match). Row<->domain mapping is a pure function
// (unit-testable); queries are integration-tested against pglite (ADR-0046).
import type { FolderListQuery, FolderPage, FolderRepository, FolderViewer } from "arp-application";
import { folderShares, folders } from "arp-db/schema";
import {
  type AppError,
  err,
  type Folder,
  type FolderId,
  folderId,
  normalizeEmailAddress,
  type OrgId,
  ok,
  orgId,
  type Result,
  userId,
  validationError,
} from "arp-domain";
import { and, asc, desc, eq, exists, gt, isNull, lt, or, sql } from "drizzle-orm";
import type { DbContext } from "./client";

type FolderRow = typeof folders.$inferSelect;

export function rowToFolder(row: FolderRow): Folder {
  return {
    id: folderId(row.id),
    orgId: orgId(row.orgId),
    parentId: row.parentId === null ? null : folderId(row.parentId),
    ownerId: row.ownerId === null ? null : userId(row.ownerId),
    visibility: row.visibility,
    name: row.name,
    slug: row.slug,
    deletedAt: row.deletedAt === null ? null : row.deletedAt.getTime(),
  };
}

/** Postgres unique-violation (SQLSTATE 23505), however the driver surfaces it. */
function isUniqueViolation(e: unknown): boolean {
  const code =
    (e as { code?: string; cause?: { code?: string } })?.code ??
    (e as { cause?: { code?: string } })?.cause?.code;
  if (code === "23505") return true;
  return /duplicate key|unique constraint/i.test(e instanceof Error ? e.message : String(e));
}

export class DrizzleFolderRepository implements FolderRepository {
  constructor(private readonly ctx: DbContext) {}

  /** The ADR-0076 visibility predicate (see the file header). `db` is needed
   *  for the EXISTS subquery on folder_shares. */
  private visibilityFor(db: ReturnType<DbContext["current"]>, viewer: FolderViewer) {
    const normalizedEmail = viewer.email ? normalizeEmailAddress(viewer.email) : undefined;
    const shareUserMatch = eq(folderShares.granteeUserId, viewer.userId);
    const shareMatch = normalizedEmail
      ? or(shareUserMatch, eq(folderShares.granteeEmail, normalizedEmail))
      : shareUserMatch;
    return or(
      eq(folders.ownerId, viewer.userId),
      isNull(folders.ownerId), // legacy (pre-ADR-0076) — visible to everyone
      eq(folders.visibility, "org"),
      exists(
        db
          .select({ one: sql`1` })
          .from(folderShares)
          .where(and(eq(folderShares.folderId, folders.id), shareMatch)),
      ),
    );
  }

  async listByOrg(org: OrgId, viewer: FolderViewer): Promise<Result<readonly Folder[], AppError>> {
    try {
      const db = this.ctx.current();
      const visibility = this.visibilityFor(db, viewer);
      const filters = [eq(folders.orgId, org), isNull(folders.deletedAt)];
      if (visibility) filters.push(visibility);
      const rows = await db
        .select()
        .from(folders)
        .where(and(...filters));
      return ok(rows.map(rowToFolder));
    } catch (e) {
      return errUnexpected("listFoldersByOrg", e);
    }
  }

  async searchByOrg(
    org: OrgId,
    viewer: FolderViewer,
    q: FolderListQuery,
  ): Promise<Result<FolderPage, AppError>> {
    // Cursor pagination (ADR-0053): keyset on the folder id (UUIDv7), DESC = newest
    // first; starting_after pages forward (id < cursor), ending_before pages back.
    try {
      const db = this.ctx.current();
      const filters = [eq(folders.orgId, org), isNull(folders.deletedAt)];
      const visibility = this.visibilityFor(db, viewer);
      if (visibility) filters.push(visibility);
      const back = q.endingBefore !== undefined;
      if (q.startingAfter) filters.push(lt(folders.id, q.startingAfter));
      if (q.endingBefore) filters.push(gt(folders.id, q.endingBefore));
      const rows = await db
        .select()
        .from(folders)
        .where(and(...filters))
        .orderBy(back ? asc(folders.id) : desc(folders.id))
        .limit(q.limit + 1);
      const hasMore = rows.length > q.limit;
      const slice = rows.slice(0, q.limit);
      const page = back ? slice.reverse() : slice;
      return ok({ items: page.map(rowToFolder), hasMore });
    } catch (e) {
      return errUnexpected("searchFoldersByOrg", e);
    }
  }

  async hasChildFolders(org: OrgId, parent: FolderId): Promise<Result<boolean, AppError>> {
    // The deleteFolder emptiness guard — org-scoped, NOT visibility-scoped
    // (ADR-0076): an invisible subfolder must still block the delete, and a
    // bare boolean surfaces no metadata.
    try {
      const db = this.ctx.current();
      const [row] = await db
        .select({ one: sql`1` })
        .from(folders)
        .where(and(eq(folders.orgId, org), eq(folders.parentId, parent), isNull(folders.deletedAt)))
        .limit(1);
      return ok(row !== undefined);
    } catch (e) {
      return errUnexpected("hasChildFolders", e);
    }
  }

  async findById(id: FolderId): Promise<Result<Folder | null, AppError>> {
    try {
      const db = this.ctx.current();
      const [row] = await db.select().from(folders).where(eq(folders.id, id)).limit(1);
      return ok(row ? rowToFolder(row) : null);
    } catch (e) {
      return errUnexpected("findFolder", e);
    }
  }

  async save(folder: Folder): Promise<Result<void, AppError>> {
    try {
      const db = this.ctx.current();
      // Insert, or update the mutable fields on conflict by id (rename → name/slug,
      // reparent → parentId, visibility/adoption → ownerId/visibility,
      // soft-delete → deletedAt). ADR-0036 / ADR-0076.
      await db
        .insert(folders)
        .values({
          id: folder.id,
          orgId: folder.orgId,
          parentId: folder.parentId,
          ownerId: folder.ownerId,
          visibility: folder.visibility,
          name: folder.name,
          slug: folder.slug,
          deletedAt: folder.deletedAt === null ? null : new Date(folder.deletedAt),
        })
        .onConflictDoUpdate({
          target: folders.id,
          set: {
            parentId: folder.parentId,
            ownerId: folder.ownerId,
            visibility: folder.visibility,
            name: folder.name,
            slug: folder.slug,
            deletedAt: folder.deletedAt === null ? null : new Date(folder.deletedAt),
            updatedAt: new Date(),
          },
        });
      return ok(undefined);
    } catch (e) {
      if (isUniqueViolation(e)) {
        return err(validationError(`a folder '${folder.slug}' already exists here`, "name"));
      }
      return errUnexpected("saveFolder", e);
    }
  }

  async softDelete(id: FolderId): Promise<Result<void, AppError>> {
    try {
      const db = this.ctx.current();
      await db
        .update(folders)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(folders.id, id), isNull(folders.deletedAt)));
      return ok(undefined);
    } catch (e) {
      return errUnexpected("softDeleteFolder", e);
    }
  }
}

function errUnexpected(op: string, e: unknown): Result<never, AppError> {
  return {
    ok: false,
    error: { kind: "Unexpected", message: `${op}: ${e instanceof Error ? e.message : String(e)}` },
  };
}
