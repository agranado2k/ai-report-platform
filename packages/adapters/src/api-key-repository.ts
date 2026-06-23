// DrizzleApiKeyRepository — issues + verifies `arp_` API keys against the
// `api_keys` table (ADR-0008, Identity & Access). Verification narrows by the
// indexed `key_prefix`, then constant-time-compares the HMAC of the presented
// secret (ApiKeyService) against the candidates — only the HMAC is stored, never
// the secret. A hit resolves the issuing User + Org + that Org's
// Root folder (the Phase-1 write default, ADR-0048) and bumps `last_used_at`.
// Row I/O + crypto only; the seam (auth.server.ts) decides how to use the actor.
import type { ApiKeyPrincipal, ApiKeyStore, ApiKeySummary } from "arp-application";
import { apiKeys, folders } from "arp-db/schema";
import {
  type AppError,
  folderId,
  type OrgId,
  ok,
  orgId,
  type Result,
  type UserId,
  userId,
} from "arp-domain";
import { and, desc, eq, isNull } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { DbContext } from "./client";
import type { ApiKeyService } from "./services/api-key";

type ApiKeyRow = typeof apiKeys.$inferSelect;

/** Defensive read of the `scopes` jsonb column: keep only string entries, else empty. */
function asScopes(raw: unknown): readonly string[] {
  return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string") : [];
}

function rowToSummary(row: ApiKeyRow): ApiKeySummary {
  return {
    id: row.id,
    name: row.name,
    scopes: asScopes(row.scopes),
    keyPrefix: row.keyPrefix,
    createdAt: row.createdAt.getTime(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.getTime() : null,
    revokedAt: row.revokedAt ? row.revokedAt.getTime() : null,
  };
}

export class DrizzleApiKeyRepository implements ApiKeyStore {
  constructor(
    private readonly ctx: DbContext,
    private readonly keys: ApiKeyService,
  ) {}

  async verify(token: string): Promise<Result<ApiKeyPrincipal | null, AppError>> {
    try {
      const db = this.ctx.current();
      const candidates = await db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.keyPrefix, this.keys.prefixOf(token)));
      // Constant-time hash compare per candidate; live keys only. Prefix collisions
      // are rare, so this is a handful of comparisons at most.
      const match = candidates.find(
        (row) => row.revokedAt === null && this.keys.verify(token, row.keyHash),
      );
      if (!match) return ok(null);

      const root = await this.rootFolderId(match.issuedInOrgId);
      if (!root) {
        // A matched key whose org has no Root folder is a server-side invariant
        // violation (every org gets one at provisioning, ADR-0048), NOT an invalid
        // key — surface Unexpected (→ 500) so it's diagnosable, not a silent 401.
        return thrown("apiKey.verify", new Error(`org ${match.issuedInOrgId} has no Root folder`));
      }

      // Best-effort usage stamp: a failed UPDATE must NOT fail an otherwise-valid
      // auth (it sits inside the outer try, which would turn it into a 500), so
      // swallow its errors — `last_used_at` is advisory.
      try {
        await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, match.id));
      } catch {
        // ignore
      }

      return ok({
        userId: userId(match.actingUserId),
        orgId: orgId(match.issuedInOrgId),
        rootFolderId: folderId(root),
        scopes: asScopes(match.scopes),
      });
    } catch (e) {
      return thrown("apiKey.verify", e);
    }
  }

  async create(input: {
    readonly actingUserId: UserId;
    readonly issuedInOrgId: OrgId;
    readonly name: string;
    readonly scopes: readonly string[];
  }): Promise<Result<{ readonly token: string; readonly summary: ApiKeySummary }, AppError>> {
    try {
      const minted = this.keys.generate();
      const id = uuidv7();
      const createdAt = new Date();
      await this.ctx
        .current()
        .insert(apiKeys)
        .values({
          id,
          actingUserId: input.actingUserId,
          issuedInOrgId: input.issuedInOrgId,
          name: input.name,
          scopes: [...input.scopes],
          keyPrefix: minted.prefix,
          keyHash: minted.hash,
          createdAt,
        });
      const summary: ApiKeySummary = {
        id,
        name: input.name,
        scopes: input.scopes,
        keyPrefix: minted.prefix,
        createdAt: createdAt.getTime(),
        lastUsedAt: null,
        revokedAt: null,
      };
      return ok({ token: minted.token, summary });
    } catch (e) {
      return thrown("apiKey.create", e);
    }
  }

  async listForUser(actingUser: UserId): Promise<Result<readonly ApiKeySummary[], AppError>> {
    try {
      const rows = await this.ctx
        .current()
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.actingUserId, actingUser))
        .orderBy(desc(apiKeys.createdAt));
      return ok(rows.map(rowToSummary));
    } catch (e) {
      return thrown("apiKey.listForUser", e);
    }
  }

  async revoke(id: string, actingUser: UserId): Promise<Result<void, AppError>> {
    try {
      // Scope the revoke to the owner, and only live keys (idempotent re-revoke).
      await this.ctx
        .current()
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(
          and(eq(apiKeys.id, id), eq(apiKeys.actingUserId, actingUser), isNull(apiKeys.revokedAt)),
        );
      return ok(undefined);
    } catch (e) {
      return thrown("apiKey.revoke", e);
    }
  }

  async revokeAllForUser(actingUser: UserId): Promise<Result<number, AppError>> {
    try {
      // The user-soft-delete cascade (ADR-0054): revoke every LIVE key the user owns.
      const rows = await this.ctx
        .current()
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.actingUserId, actingUser), isNull(apiKeys.revokedAt)))
        .returning({ id: apiKeys.id });
      return ok(rows.length);
    } catch (e) {
      return thrown("apiKey.revokeAllForUser", e);
    }
  }

  private async rootFolderId(orgRowId: string): Promise<string | undefined> {
    const [f] = await this.ctx
      .current()
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.orgId, orgRowId), isNull(folders.parentId)))
      .limit(1);
    return f?.id;
  }
}

function thrown(op: string, e: unknown): Result<never, AppError> {
  return {
    ok: false,
    error: { kind: "Unexpected", message: `${op}: ${e instanceof Error ? e.message : String(e)}` },
  };
}
