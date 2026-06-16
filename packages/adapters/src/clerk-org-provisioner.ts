// ClerkBackendOrgProvisioner — creates a personal Clerk Organization via the
// Clerk backend API when a session carries no active org (ADR-0048). Clerk
// doesn't auto-create personal orgs, so identity provisioning calls this; the
// creator becomes the org admin. Infra adapter (ADR-0020) behind the
// application's ClerkOrgProvisioner port.
import { createClerkClient } from "@clerk/backend";
import type { ClerkOrgProvisioner } from "arp-application";
import { type AppError, ok, type Result } from "arp-domain";

/** The slice of the Clerk backend API we depend on — narrow so tests can fake it. */
export interface ClerkOrgApi {
  createOrganization(params: {
    readonly name: string;
    readonly createdBy: string;
  }): Promise<{ readonly id: string }>;
}

export class ClerkBackendOrgProvisioner implements ClerkOrgProvisioner {
  constructor(private readonly orgs: ClerkOrgApi) {}

  /** Build from the Clerk secret key (the composition root passes `CLERK_SECRET_KEY`). */
  static fromSecretKey(secretKey: string): ClerkBackendOrgProvisioner {
    return new ClerkBackendOrgProvisioner(createClerkClient({ secretKey }).organizations);
  }

  async createPersonalOrg(clerkUserId: string, name: string): Promise<Result<string, AppError>> {
    try {
      const org = await this.orgs.createOrganization({ name, createdBy: clerkUserId });
      return ok(org.id);
    } catch (e) {
      return {
        ok: false,
        error: {
          kind: "Unexpected",
          message: `clerk.createOrganization: ${e instanceof Error ? e.message : String(e)}`,
        },
      };
    }
  }
}
