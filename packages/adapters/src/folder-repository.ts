// DrizzleFolderRepository — persists the Folder aggregate against the `folders`
// table (ADR-0020). Sibling-slug uniqueness is enforced by the DB
// (folders_org_parent_slug_uniq); a violation maps to a client-correctable
// ValidationError. Row<->domain mapping is a pure function (unit-testable);
// queries are integration-tested against pglite (ADR-0046).
import type { FolderRepository } from "arp-application";
import { folders } from "arp-db/schema";
import {
  type AppError,
  err,
  type Folder,
  type FolderId,
  folderId,
  type OrgId,
  ok,
  orgId,
  type Result,
  validationError,
} from "arp-domain";
import { and, eq, isNull } from "drizzle-orm";
import type { DbContext } from "./client";

type FolderRow = typeof folders.$inferSelect;

export function rowToFolder(row: FolderRow): Folder {
  return {
    id: folderId(row.id),
    orgId: orgId(row.orgId),
    parentId: row.parentId === null ? null : folderId(row.parentId),
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

  async listByOrg(org: OrgId): Promise<Result<readonly Folder[], AppError>> {
    try {
      const db = this.ctx.current();
      const rows = await db
        .select()
        .from(folders)
        .where(and(eq(folders.orgId, org), isNull(folders.deletedAt)));
      return ok(rows.map(rowToFolder));
    } catch (e) {
      return errUnexpected("listFoldersByOrg", e);
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
      // reparent → parentId, soft-delete → deletedAt). ADR-0036.
      await db
        .insert(folders)
        .values({
          id: folder.id,
          orgId: folder.orgId,
          parentId: folder.parentId,
          name: folder.name,
          slug: folder.slug,
          deletedAt: folder.deletedAt === null ? null : new Date(folder.deletedAt),
        })
        .onConflictDoUpdate({
          target: folders.id,
          set: {
            parentId: folder.parentId,
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
