// DrizzleFolderShareStore — per-folder visibility shares (ADR-0076) over the
// `folder_shares` table. Modeled line-for-line on DrizzleWriteGrantStore
// (ADR-0060): grant/revoke are upsert / delete-by-key; no expiry, no level.
// `findFor` backs the folder visibility predicate's share leg — it matches
// BOTH by the resolved `grantee_user_id` and by normalized email (the durable
// key for a grantee who signed up after being shared with), since
// `grantee_user_id` is only ever resolved opportunistically at share time.
// Deliberately NOT the superseded `folder_collaborators` table (ADR-009 corpse
// awaiting its cleanup migration) — different semantics: shares confer
// visibility only, never write.
import type { FolderShare, FolderShareStore } from "arp-application";
import { folderShares } from "arp-db/schema";
import {
  type AppError,
  err,
  type FolderId,
  folderId,
  normalizeEmailAddress,
  ok,
  type Result,
  type UserId,
  userId,
} from "arp-domain";
import { and, eq, or } from "drizzle-orm";
import type { DbContext } from "./client";

function shareErr(op: string, e: unknown): Result<never, AppError> {
  return err({ kind: "Unexpected", message: `folderShareStore.${op}: ${String(e)}` });
}

const normEmail = normalizeEmailAddress;

function toDomain(row: {
  folderId: string;
  granteeEmail: string;
  granteeUserId: string | null;
  grantedBy: string;
  grantedAt: Date;
}): FolderShare {
  return {
    folderId: folderId(row.folderId),
    granteeEmail: row.granteeEmail,
    granteeUserId: row.granteeUserId ? userId(row.granteeUserId) : null,
    grantedBy: userId(row.grantedBy),
    grantedAt: row.grantedAt.getTime(),
  };
}

export class DrizzleFolderShareStore implements FolderShareStore {
  constructor(private readonly ctx: DbContext) {}

  async grant(
    folder: FolderId,
    email: string,
    grantedBy: UserId,
    granteeUserId: UserId | null,
  ): Promise<Result<void, AppError>> {
    try {
      const normalized = normEmail(email);
      await this.ctx
        .current()
        .insert(folderShares)
        .values({
          folderId: folder,
          granteeEmail: normalized,
          granteeUserId,
          grantedBy,
        })
        .onConflictDoUpdate({
          target: [folderShares.folderId, folderShares.granteeEmail],
          // Refresh grantedBy/grantedAt/granteeUserId on a re-share — a later
          // opportunistic resolution (the grantee signed up since) should stick.
          set: { grantedBy, granteeUserId, grantedAt: new Date() },
        });
      return ok(undefined);
    } catch (e) {
      return shareErr("grant", e);
    }
  }

  async revoke(folder: FolderId, email: string): Promise<Result<void, AppError>> {
    try {
      await this.ctx
        .current()
        .delete(folderShares)
        .where(
          and(eq(folderShares.folderId, folder), eq(folderShares.granteeEmail, normEmail(email))),
        );
      return ok(undefined);
    } catch (e) {
      return shareErr("revoke", e);
    }
  }

  async listByFolder(folder: FolderId): Promise<Result<readonly FolderShare[], AppError>> {
    try {
      const rows = await this.ctx
        .current()
        .select()
        .from(folderShares)
        .where(eq(folderShares.folderId, folder));
      return ok(rows.map(toDomain));
    } catch (e) {
      return shareErr("listByFolder", e);
    }
  }

  async findFor(
    folder: FolderId,
    actor: { readonly userId: UserId; readonly email?: string },
  ): Promise<Result<FolderShare | null, AppError>> {
    try {
      const emailMatch = actor.email
        ? eq(folderShares.granteeEmail, normEmail(actor.email))
        : undefined;
      const userIdMatch = eq(folderShares.granteeUserId, actor.userId);
      const [row] = await this.ctx
        .current()
        .select()
        .from(folderShares)
        .where(
          and(
            eq(folderShares.folderId, folder),
            emailMatch ? or(userIdMatch, emailMatch) : userIdMatch,
          ),
        )
        .limit(1);
      return ok(row ? toDomain(row) : null);
    } catch (e) {
      return shareErr("findFor", e);
    }
  }
}
