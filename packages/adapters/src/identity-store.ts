// DrizzleIdentityStore — mirrors a Clerk identity into our `users`/`orgs`/`folders`
// (ADR-0048, Identity & Access). find-or-create per entity so it's idempotent and
// safe when a User already belongs to another Org (shared user pool, ADR-005).
// Row I/O only; the provisioning policy lives in the provisionIdentity use case.
import type {
  AuthorIdentity,
  CursorPage,
  CursorParams,
  IdentityStore,
  MirroredUserRef,
  ProvisionedIdentity,
} from "arp-application";
import { folders, orgs, users } from "arp-db/schema";
import {
  type AppError,
  conflict,
  err,
  folderId,
  normalizeEmailAddress,
  notAllowed,
  type OrgId,
  type OrgKind,
  ok,
  orgId,
  type Result,
  type UserId,
  userId,
} from "arp-domain";
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
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

  async findTeamOrgByDomain(
    domain: string,
  ): Promise<Result<{ orgId: OrgId; clerkOrgId: string } | null, AppError>> {
    try {
      // The app-owned domain index (ADR-0074): `orgs.domain` is the canonical
      // team-org join key (Clerk organization-domains is 402-gated on the free
      // plan). A miss means either nobody at this domain is provisioned or the
      // row predates migration 0018 (caller falls through to the anchor scan).
      const [o] = await this.ctx
        .current()
        .select({ id: orgs.id, clerkOrgId: orgs.clerkOrgId })
        .from(orgs)
        .where(eq(orgs.domain, domain.toLowerCase()))
        .limit(1);
      return ok(o ? { orgId: orgId(o.id), clerkOrgId: o.clerkOrgId } : null);
    } catch (e) {
      return thrown("identity.findTeamOrgByDomain", e);
    }
  }

  async upsertTeamOrg(input: {
    readonly clerkOrgId: string;
    readonly name: string;
    readonly domain: string;
  }): Promise<Result<{ orgId: OrgId }, AppError>> {
    try {
      // The webhook's org-only write (ADR-0074): find-or-create the Org row
      // (kind `team`) + its Root folder; the USER row still mirrors at first
      // write (ADR-0048). On a clerk_org_id conflict the existing row wins and
      // COALESCE sets `domain` ONLY if currently null — the set-domain-if-null
      // heal for pre-0018 rows (House Numbers) — never re-keying a domained row.
      const provisioned = await this.ctx.run(async () => {
        const db = this.ctx.current();
        await db
          .insert(orgs)
          .values({
            id: uuidv7(),
            clerkOrgId: input.clerkOrgId,
            name: input.name,
            kind: "team",
            domain: input.domain.toLowerCase(),
            planLimitsJson: {},
          })
          .onConflictDoUpdate({
            target: orgs.clerkOrgId,
            set: {
              domain: sql`coalesce(${orgs.domain}, excluded.domain)`,
              updatedAt: new Date(),
            },
          });
        const [o] = await db
          .select({ id: orgs.id })
          .from(orgs)
          .where(eq(orgs.clerkOrgId, input.clerkOrgId))
          .limit(1);
        if (!o) throw new Error("org missing after upsert");

        // Root-folder invariant (same find-or-create as createIdentity).
        let root = await this.rootFolderId(o.id);
        if (!root) {
          await db
            .insert(folders)
            .values({ id: uuidv7(), orgId: o.id, name: "Root", slug: "root", parentId: null })
            .onConflictDoNothing();
          root = await this.rootFolderId(o.id);
        }
        if (!root) throw new Error("root folder missing after insert");
        return { orgId: orgId(o.id) };
      });
      return ok(provisioned);
    } catch (e) {
      // A 23505 on orgs_domain_uniq = a DIFFERENT org row already owns the
      // domain (the concurrent same-domain first-sign-up race). Typed Conflict
      // so the caller re-reads the index and joins the winner (ADR-0074).
      if (isDomainUniqueViolation(e)) {
        return err(conflict(`domain "${input.domain}" already belongs to another org`));
      }
      return thrown("identity.upsertTeamOrg", e);
    }
  }

  async createIdentity(input: {
    readonly clerkUserId: string;
    readonly clerkOrgId: string;
    readonly email: string;
    readonly displayName: string | null;
    readonly orgName: string;
    readonly kind: OrgKind;
    readonly domain?: string | null;
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
          .values({
            id: uuidv7(),
            clerkUserId: input.clerkUserId,
            email: input.email,
            displayName: input.displayName,
          })
          .onConflictDoUpdate({
            target: users.clerkUserId,
            // Refresh the mirrored name too (ADR-0063 author display), but COALESCE
            // so a later claim-less re-provision (displayName null) never wipes a
            // name captured earlier — unlike `email`, which always overwrites.
            set: {
              email: input.email,
              displayName: sql`coalesce(${input.displayName}, ${users.displayName})`,
              updatedAt: new Date(),
            },
          });
        const [u] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.clerkUserId, input.clerkUserId))
          .limit(1);

        // Org: find-or-create by clerk_org_id (Plan defaults to `free`). `kind`
        // is set only on first creation (ADR-0068 §3) — a JIT join to an
        // existing team org hits the on-conflict branch and the existing row's
        // kind (set by whoever created it) is left untouched. A team `domain`
        // (ADR-0074) is recorded on creation; on conflict COALESCE sets it
        // ONLY if currently null (the same set-domain-if-null heal as
        // upsertTeamOrg). Personal provisions (no domain) keep the pure
        // do-nothing conflict path — zero write churn on re-provision.
        const domain = input.domain ? input.domain.toLowerCase() : null;
        const orgInsert = db.insert(orgs).values({
          id: uuidv7(),
          clerkOrgId: input.clerkOrgId,
          name: input.orgName,
          kind: input.kind,
          domain,
          planLimitsJson: {},
        });
        await (domain
          ? orgInsert.onConflictDoUpdate({
              target: orgs.clerkOrgId,
              set: {
                domain: sql`coalesce(${orgs.domain}, excluded.domain)`,
                updatedAt: new Date(),
              },
            })
          : orgInsert.onConflictDoNothing());
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
      // Same typed race signal as upsertTeamOrg (ADR-0074): another org row
      // already owns this domain → caller re-resolves via the index.
      if (isDomainUniqueViolation(e)) {
        return err(conflict(`domain "${input.domain}" already belongs to another org`));
      }
      return thrown("identity.createIdentity", e);
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
      // Exclude soft-deleted users (matches findByClerkUserId / findUserIdByEmail):
      // soft-delete stamps deleted_at but never scrubs `email` (softDeleteByClerkId),
      // so without this filter a since-deleted author's email would still resolve —
      // leaking PII into audit-adjacent surfaces (version-author, comment-author)
      // contrary to ADR-0054's terminal-deletion + ADR-0070's erasure posture.
      const [row] = await this.ctx
        .current()
        .select({ email: users.email })
        .from(users)
        .where(and(eq(users.id, uid), isNull(users.deletedAt)))
        .limit(1);
      return ok(row?.email ?? null);
    } catch (e) {
      return thrown("identity.findEmailByUserId", e);
    }
  }

  async findAuthorIdentityByUserId(uid: UserId): Promise<Result<AuthorIdentity | null, AppError>> {
    try {
      // Same soft-delete exclusion as findEmailByUserId: a since-deleted author's
      // name/email must not leak into the comments/versions author surfaces
      // (ADR-0054 terminal deletion, ADR-0070 erasure posture). One query resolves
      // both columns — batch-friendly for the per-author list enrichment (ADR-0063).
      const [row] = await this.ctx
        .current()
        .select({ email: users.email, displayName: users.displayName })
        .from(users)
        .where(and(eq(users.id, uid), isNull(users.deletedAt)))
        .limit(1);
      return ok(row ? { email: row.email, displayName: row.displayName ?? null } : null);
    } catch (e) {
      return thrown("identity.findAuthorIdentityByUserId", e);
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

  async listUsersMissingDisplayName(
    q: CursorParams<UserId>,
  ): Promise<Result<CursorPage<MirroredUserRef>, AppError>> {
    try {
      // Target set for the one-time backfill (roadmap #59): live users whose
      // mirrored name was never captured. Keyset on the UUIDv7 id DESC (ADR-0053),
      // fetch limit+1 to derive hasMore without a COUNT.
      const conditions = [isNull(users.displayName), isNull(users.deletedAt)];
      if (q.startingAfter) conditions.push(lt(users.id, q.startingAfter));
      const rows = await this.ctx
        .current()
        .select({ id: users.id, clerkUserId: users.clerkUserId })
        .from(users)
        .where(and(...conditions))
        .orderBy(desc(users.id))
        .limit(q.limit + 1);
      const hasMore = rows.length > q.limit;
      const items = rows
        .slice(0, q.limit)
        .map((r) => ({ userId: userId(r.id), clerkUserId: r.clerkUserId }));
      return ok({ items, hasMore });
    } catch (e) {
      return thrown("identity.listUsersMissingDisplayName", e);
    }
  }

  async setDisplayNameIfNull(uid: UserId, displayName: string): Promise<Result<boolean, AppError>> {
    try {
      // The `IS NULL` predicate makes the backfill idempotent + race-safe: a
      // concurrent live JIT provision that set the name first leaves 0 rows
      // updated here (returns false), and a re-run never overwrites. deleted_at
      // guard keeps us from resurrecting name onto a soft-deleted row (ADR-0054).
      const [row] = await this.ctx
        .current()
        .update(users)
        .set({ displayName, updatedAt: new Date() })
        .where(and(eq(users.id, uid), isNull(users.displayName), isNull(users.deletedAt)))
        .returning({ id: users.id });
      return ok(!!row);
    } catch (e) {
      return thrown("identity.setDisplayNameIfNull", e);
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

/** Whether a thrown DB error is a unique violation on `orgs_domain_uniq`
 *  (ADR-0074's partial unique index). Postgres surfaces code 23505 with the
 *  constraint name; drivers (neon-serverless, pglite) may wrap the error, so
 *  walk `cause` and fall back to a message match on the index name. */
function isDomainUniqueViolation(e: unknown): boolean {
  let current: unknown = e;
  for (let depth = 0; depth < 5 && current !== null && typeof current === "object"; depth += 1) {
    const candidate = current as {
      code?: unknown;
      constraint?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    const constraint = typeof candidate.constraint === "string" ? candidate.constraint : "";
    const message = typeof candidate.message === "string" ? candidate.message : "";
    if (candidate.code === "23505" && constraint === "orgs_domain_uniq") return true;
    if (message.includes("orgs_domain_uniq")) return true;
    current = candidate.cause;
  }
  return false;
}

function thrown(op: string, e: unknown): Result<never, AppError> {
  return {
    ok: false,
    error: { kind: "Unexpected", message: `${op}: ${e instanceof Error ? e.message : String(e)}` },
  };
}
