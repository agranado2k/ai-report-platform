// ClerkBackendOrgProvisioner — creates (or reuses) a personal Clerk Organization
// when a session carries no active org (ADR-0048). Clerk doesn't auto-create
// personal orgs, so identity provisioning calls this; the creator becomes the
// org admin. Infra adapter (ADR-0020) behind the application's ClerkOrgProvisioner
// port.
import { createClerkClient } from "@clerk/backend";
import type { ClerkOrgProvisioner } from "arp-application";
import { type AppError, err, ok, type Result } from "arp-domain";

/** The slice of the Clerk backend API we depend on — narrow so tests can fake it. */
export interface ClerkOrgApi {
  createOrganization(params: {
    readonly name: string;
    readonly createdBy: string;
  }): Promise<{ readonly id: string }>;
  /** The orgs a user belongs to — used to reuse an existing personal org (idempotency). */
  getOrganizationMembershipList(params: { readonly userId: string }): Promise<{
    readonly data: ReadonlyArray<{
      readonly organization: { readonly id: string; readonly createdAt: number };
    }>;
  }>;
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
    try {
      const memberships = await this.orgs.getOrganizationMembershipList({ userId: clerkUserId });
      const oldest = [...(memberships.data ?? [])].sort(
        (a, b) => a.organization.createdAt - b.organization.createdAt,
      )[0];
      if (oldest) return ok(oldest.organization.id);
    } catch {
      // Lookup failed — favour availability over dedupe and fall through to create.
      // A transient list failure shouldn't block the user from getting an org.
    }

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
}
