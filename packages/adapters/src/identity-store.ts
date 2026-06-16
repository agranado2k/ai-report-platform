// DrizzleIdentityStore — mirrors a Clerk identity into our `users`/`orgs`/`folders`
// (ADR-0048, Identity & Access). find-or-create per entity so it's idempotent and
// safe when a User already belongs to another Org (shared user pool, ADR-005).
// Row I/O only; the provisioning policy lives in the provisionIdentity use case.
import type { IdentityStore, ProvisionedIdentity } from "arp-application";
import { folders, orgs, users } from "arp-db/schema";
import { type AppError, folderId, ok, orgId, type Result, userId } from "arp-domain";
import { and, eq, isNull } from "drizzle-orm";
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
        .where(eq(users.clerkUserId, clerkUserId))
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

  async createPersonalIdentity(input: {
    readonly clerkUserId: string;
    readonly clerkOrgId: string;
    readonly email: string;
    readonly orgName: string;
  }): Promise<Result<ProvisionedIdentity, AppError>> {
    try {
      const db = this.ctx.current();
      // User: find-or-create (may already exist from another org — shared pool).
      await db
        .insert(users)
        .values({ id: uuidv7(), clerkUserId: input.clerkUserId, email: input.email })
        .onConflictDoNothing();
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

      if (!u || !o) return thrown("identity.create", new Error("user/org missing after upsert"));

      // Root folder: find-or-create (parent_id NULL).
      let root = await this.rootFolderId(o.id);
      if (!root) {
        await db
          .insert(folders)
          .values({ id: uuidv7(), orgId: o.id, name: "Root", slug: "root", parentId: null })
          .onConflictDoNothing();
        root = await this.rootFolderId(o.id);
      }
      if (!root) return thrown("identity.create", new Error("root folder missing after insert"));

      return ok({ userId: userId(u.id), orgId: orgId(o.id), rootFolderId: folderId(root) });
    } catch (e) {
      return thrown("identity.createPersonalIdentity", e);
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
