// ClerkBackendOrgProvisioner — creates (or reuses) a personal Clerk Organization
// when a session carries no active org (ADR-0048). Clerk doesn't auto-create
// personal orgs, so identity provisioning calls this; the creator becomes the
// org admin. Infra adapter (ADR-0020) behind the application's ClerkOrgProvisioner
// port.
import { createClerkClient } from "@clerk/backend";
import { isClerkAPIResponseError } from "@clerk/backend/errors";
import type { ClerkOrgProvisioner } from "arp-application";
import { type AppError, err, ok, type Result } from "arp-domain";

/** The default Clerk system role granted to a JIT team-org joiner (ADR-0068 §2:
 *  custom-roles infra stays open, but only `admin`/`member` are used today — the
 *  creator of an org is auto-assigned `org:admin` by Clerk; every later joiner
 *  gets `org:member`). */
const TEAM_MEMBER_ROLE = "org:member";

/** Derive a Clerk-safe org slug from an email domain (ADR-0068 §3) — a domain
 *  contains dots, which a Clerk org slug can't; hyphens are the deterministic,
 *  one-way substitute (we never need to recover the domain FROM the slug —
 *  `findTeamOrgByDomain`/`createTeamOrg` both re-derive it from the domain
 *  every time, so the mapping only has to be consistent, not reversible). */
function teamOrgSlug(domain: string): string {
  return domain.toLowerCase().replace(/\./g, "-");
}

/** The slice of the Clerk backend API we depend on — narrow so tests can fake it. */
export interface ClerkOrgApi {
  createOrganization(params: {
    readonly name: string;
    readonly slug?: string;
    readonly createdBy: string;
  }): Promise<{ readonly id: string }>;
  /** The orgs a user belongs to — used to reuse an existing personal org (idempotency)
   *  AND, for team orgs (ADR-0068 §3), to check whether a user is already a member
   *  of a given team org before minting a duplicate membership. */
  getOrganizationMembershipList(params: { readonly userId: string }): Promise<{
    readonly data: ReadonlyArray<{
      readonly organization: { readonly id: string; readonly createdAt: number };
    }>;
  }>;
  /** Look up a Clerk org by its deterministic domain-derived slug (ADR-0068 §3);
   *  null when no org has that slug. */
  getOrganizationBySlug(slug: string): Promise<{ readonly id: string } | null>;
  /** Add a user as a member of an existing org (ADR-0068 §3, JIT team-org join). */
  createOrganizationMembership(params: {
    readonly organizationId: string;
    readonly userId: string;
    readonly role: string;
  }): Promise<{ readonly id: string }>;
}

export class ClerkBackendOrgProvisioner implements ClerkOrgProvisioner {
  constructor(private readonly orgs: ClerkOrgApi) {}

  /** Build from the Clerk secret key (the composition root passes `CLERK_SECRET_KEY`). */
  static fromSecretKey(secretKey: string): ClerkBackendOrgProvisioner {
    const client = createClerkClient({ secretKey });
    // createOrganization lives on `organizations`; the membership list on `users` —
    // adapt both behind the single narrow port.
    return new ClerkBackendOrgProvisioner({
      createOrganization: (params) => client.organizations.createOrganization(params),
      getOrganizationMembershipList: (params) => client.users.getOrganizationMembershipList(params),
      getOrganizationBySlug: async (slug) => {
        try {
          const org = await client.organizations.getOrganization({ slug });
          return { id: org.id };
        } catch (e) {
          // Clerk's getOrganization throws on a 404 — that's the expected "no
          // team org for this domain yet" outcome (first sign-up), not a
          // failure. Any OTHER status (network blip, 5xx) re-throws so the
          // port surfaces it as Unexpected rather than silently treating an
          // infra hiccup as "org doesn't exist" (which would risk minting a
          // duplicate team org).
          if (isClerkAPIResponseError(e) && e.status === 404) return null;
          throw e;
        }
      },
      createOrganizationMembership: (params) =>
        client.organizations.createOrganizationMembership(params),
    });
  }

  async createPersonalOrg(clerkUserId: string, name: string): Promise<Result<string, AppError>> {
    // Idempotency guard (ADR-0048): reuse the user's existing personal org rather
    // than mint a duplicate on a repeated/SEQUENTIAL first-provision — e.g. a
    // backend-minted e2e session re-run, where each request arrives with no active
    // org. This is check-then-act, so it does NOT close a truly concurrent race
    // (two simultaneous first-uploads can both see an empty list and both create);
    // the old TODO's per-user lock would, but the blast radius is one stray org
    // and creation isn't on a hot concurrent path. Pick the OLDEST org for a
    // stable choice across calls.
    // NOTE: under the 1:1 personal-org model the user has a single membership, so
    // page-1 results suffice and "oldest" is unambiguous; revisit both the paging
    // and the heuristic when ADR-009 cross-org folder grants let a user belong to
    // others' orgs too.
    const existing = await this.findPersonalOrg(clerkUserId);
    // ok + value → reuse it. On a lookup failure (err) favour availability over
    // dedupe and fall through to create: a transient list failure shouldn't block
    // the user from getting an org.
    if (existing.ok && existing.value) return ok(existing.value);

    try {
      const org = await this.orgs.createOrganization({ name, createdBy: clerkUserId });
      return ok(org.id);
    } catch (e) {
      // TODO(abuse): map Clerk 4xx (name validation, 429 rate-limit) to typed
      // AppErrors so they don't all surface as 500 (ADR-0040).
      return err({
        kind: "Unexpected",
        message: `clerk.createOrganization: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  async findPersonalOrg(clerkUserId: string): Promise<Result<string | null, AppError>> {
    // Read-only resolution (ADR-0048): the org the write path would reuse, picked
    // as the OLDEST membership for a stable choice. null when the user has none —
    // never creates. A lookup failure is surfaced as Unexpected so the caller can
    // log it (the read path then degrades to an empty list rather than guessing).
    try {
      const memberships = await this.orgs.getOrganizationMembershipList({ userId: clerkUserId });
      const oldest = [...(memberships.data ?? [])].sort(
        (a, b) => a.organization.createdAt - b.organization.createdAt,
      )[0];
      return ok(oldest ? oldest.organization.id : null);
    } catch (e) {
      return err({
        kind: "Unexpected",
        message: `clerk.getOrganizationMembershipList: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  async findTeamOrgByDomain(domain: string): Promise<Result<string | null, AppError>> {
    // Read-only resolution (ADR-0068 §3): the team org an existing domain member
    // would join, or null when nobody at this domain has signed up yet. Never
    // creates — mirrors findPersonalOrg's read/write split.
    try {
      const org = await this.orgs.getOrganizationBySlug(teamOrgSlug(domain));
      return ok(org ? org.id : null);
    } catch (e) {
      return err({
        kind: "Unexpected",
        message: `clerk.getOrganizationBySlug: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  async createTeamOrg(domain: string, createdBy: string): Promise<Result<string, AppError>> {
    // ADR-0068 §3: the FIRST sign-up at a corporate domain creates its team org.
    // `name` is the domain itself (e.g. "housenumbers.io") — there's no other
    // display name to draw from at JIT time; `slug` is the same deterministic
    // mapping `findTeamOrgByDomain` uses, so a later joiner's lookup finds this
    // org. The creator becomes the Clerk org admin automatically; every later
    // joiner gets `ensureMembership`'s member role.
    try {
      const org = await this.orgs.createOrganization({
        name: domain,
        slug: teamOrgSlug(domain),
        createdBy,
      });
      return ok(org.id);
    } catch (e) {
      return err({
        kind: "Unexpected",
        message: `clerk.createOrganization(team): ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  async ensureMembership(clerkOrgId: string, clerkUserId: string): Promise<Result<void, AppError>> {
    // Idempotent, concurrency-tolerant join (ADR-0068 §3): check-then-act, same
    // accepted trade-off as createPersonalOrg's dedupe guard (a truly concurrent
    // double-join attempt can race — Clerk itself rejects the duplicate, and we
    // treat that as success too, below). Reuses the SAME membership-list lookup
    // findPersonalOrg/createPersonalOrg already depend on (client.users.
    // getOrganizationMembershipList) rather than a new Clerk endpoint.
    try {
      const memberships = await this.orgs.getOrganizationMembershipList({ userId: clerkUserId });
      const alreadyMember = (memberships.data ?? []).some((m) => m.organization.id === clerkOrgId);
      if (alreadyMember) return ok(undefined);

      await this.orgs.createOrganizationMembership({
        organizationId: clerkOrgId,
        userId: clerkUserId,
        role: TEAM_MEMBER_ROLE,
      });
      return ok(undefined);
    } catch (e) {
      // A concurrent duplicate-join lands here as a Clerk 4xx ("already a
      // member") — treat it as the idempotent success it is, same intent as the
      // check above; anything else is a genuine Unexpected failure.
      if (isClerkAPIResponseError(e) && e.status === 422) return ok(undefined);
      return err({
        kind: "Unexpected",
        message: `clerk.createOrganizationMembership: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
}
