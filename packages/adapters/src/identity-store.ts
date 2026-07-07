// DrizzleIdentityStore — mirrors a Clerk identity into our `users`/`orgs`/`folders`
// (ADR-0048, Identity & Access). find-or-create per entity so it's idempotent and
// safe when a User already belongs to another Org (shared user pool, ADR-005).
// Row I/O only; the provisioning policy lives in the provisionIdentity use case.
import type { IdentityStore, ProvisionedIdentity } from "arp-application";
import { folders, orgs, users } from "arp-db/schema";
import {
  type AppError,
  err,
  folderId,
  normalizeEmailAddress,
  notAllowed,
  type OrgId,
  ok,
  orgId,
  type Result,
  type UserId,
  userId,
} from "arp-domain";
import { and, eq, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { DbContext } from "./client";

export class DrizzleIdentityStore implements IdentityStore {
  constructor(private readonly ctx: DbContext) {}

  async findByClerk(
    clerkUserId: string,
    clerkOrgId: string,
  ): Promise<Result<ProvisionedIdentity | null, AppError>> {
    try {
      const db = this.ctx.current();
      const [u] = await db
        .select({ id: users.id })
        .from(users)
        // Soft-deleted users don't resolve as an actor (ADR-0054).
        .where(and(eq(users.clerkUserId, clerkUserId), isNull(users.deletedAt)))
        .limit(1);
      const [o] = await db
        .select({ id: orgs.id })
        .from(orgs)
        .where(eq(orgs.clerkOrgId, clerkOrgId))
        .limit(1);
      if (!u || !o) return ok(null);
      const root = await this.rootFolderId(o.id);
      if (!root) return ok(null);
      return ok({ userId: userId(u.id), orgId: orgId(o.id), rootFolderId: folderId(root) });
    } catch (e) {
      return thrown("identity.findByClerk", e);
    }
  }

  async findOrgByClerkOrgId(clerkOrgId: string): Promise<Result<OrgId | null, AppError>> {
    try {
      const db = this.ctx.current();
      const [o] = await db
        .select({ id: orgs.id })
        .from(orgs)
        .where(eq(orgs.clerkOrgId, clerkOrgId))
        .limit(1);
      return ok(o ? orgId(o.id) : null);
    } catch (e) {
      return thrown("identity.findOrgByClerkOrgId", e);
    }
  }

  async createPersonalIdentity(input: {
    readonly clerkUserId: string;
    readonly clerkOrgId: string;
    readonly email: string;
    readonly orgName: string;
  }): Promise<Result<ProvisionedIdentity, AppError>> {
    try {
      // Deletion is terminal — never resurrect a soft-deleted user (ADR-0054). A
      // re-auth with the same Clerk id stays blocked until an explicit restore.
      const [existing] = await this.ctx
        .current()
        .select({ deletedAt: users.deletedAt })
        .from(users)
        .where(eq(users.clerkUserId, input.clerkUserId))
        .limit(1);
      if (existing?.deletedAt != null) {
        return err(notAllowed("this account has been deleted"));
      }
      // One transaction so the User/Org/Root-folder trio commits all-or-nothing.
      // Concurrency-safe: each find-or-create is an upsert guarded by a unique
      // index (clerk_user_id, clerk_org_id, and the partial Root-folder index),
      // so a concurrent provision can't create duplicates (ADR-0048).
      const provisioned = await this.ctx.run(async () => {
        const db = this.ctx.current();
        // User: find-or-create (may already exist from another org — shared pool).
        // On conflict, refresh the mirrored email: it feeds ADR-0060 write-grant
        // matching, and a stale copy silently 403s a grantee whose Clerk primary
        // email changed (review #150 M-2).
        await db
          .insert(users)
          .values({ id: uuidv7(), clerkUserId: input.clerkUserId, email: input.email })
          .onConflictDoUpdate({
            target: users.clerkUserId,
            set: { email: input.email, updatedAt: new Date() },
          });
        const [u] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.clerkUserId, input.clerkUserId))
          .limit(1);

        // Org: find-or-create by clerk_org_id (Plan defaults to `free`).
        await db
          .insert(orgs)
          .values({
            id: uuidv7(),
            clerkOrgId: input.clerkOrgId,
            name: input.orgName,
            planLimitsJson: {},
          })
          .onConflictDoNothing();
        const [o] = await db
          .select({ id: orgs.id })
          .from(orgs)
          .where(eq(orgs.clerkOrgId, input.clerkOrgId))
          .limit(1);

        if (!u || !o) throw new Error("user/org missing after upsert");

        // Root folder: find-or-create (parent_id NULL; partial-unique by org+slug).
        let root = await this.rootFolderId(o.id);
        if (!root) {
          await db
            .insert(folders)
            .values({ id: uuidv7(), orgId: o.id, name: "Root", slug: "root", parentId: null })
            .onConflictDoNothing();
          root = await this.rootFolderId(o.id);
        }
        if (!root) throw new Error("root folder missing after insert");

        return { userId: userId(u.id), orgId: orgId(o.id), rootFolderId: folderId(root) };
      });
      return ok(provisioned);
    } catch (e) {
      return thrown("identity.createPersonalIdentity", e);
    }
  }

  async softDeleteByClerkId(clerkUserId: string): Promise<Result<UserId | null, AppError>> {
    try {
      // Stamp deleted_at on the LIVE user only (idempotent: a replay updates 0 rows).
      // Resolve + stamp regardless of prior delete state, so a retried webhook still
      // drives the (idempotent) cascade (self-healing, ADR-0054). COALESCE preserves
      // the original deleted_at; RETURNING gives the id to cascade on. null = no row.
      const [row] = await this.ctx
        .current()
        .update(users)
        .set({ deletedAt: sql`coalesce(${users.deletedAt}, now())` })
        .where(eq(users.clerkUserId, clerkUserId))
        .returning({ id: users.id });
      return ok(row ? userId(row.id) : null);
    } catch (e) {
      return thrown("identity.softDeleteByClerkId", e);
    }
  }

  async findEmailByUserId(uid: UserId): Promise<Result<string | null, AppError>> {
    try {
      const [row] = await this.ctx
        .current()
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, uid))
        .limit(1);
      return ok(row?.email ?? null);
    } catch (e) {
      return thrown("identity.findEmailByUserId", e);
    }
  }

  async findUserIdByEmail(email: string): Promise<Result<UserId | null, AppError>> {
    try {
      // Case-insensitive match — `users.email` is the raw Clerk email (not
      // pre-normalized on write), while the caller's email is always the
      // normalized EmailAddress (ADR-0060 §2's grant-matching contract).
      const [row] = await this.ctx
        .current()
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            sql`lower(${users.email}) = ${normalizeEmailAddress(email)}`,
            isNull(users.deletedAt),
          ),
        )
        .limit(1);
      return ok(row ? userId(row.id) : null);
    } catch (e) {
      return thrown("identity.findUserIdByEmail", e);
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
