// provisionIdentity — resolve a Clerk identity into our UploadActor, creating the
// mirror (User + personal Org + Root folder) on first sight (ADR-0048). Pure
// orchestration over the IdentityStore + ClerkOrgProvisioner ports (ADR-0024):
// the policy (app creates the personal Clerk org when the session has none, then
// find-or-create the mirror) lives here; all I/O is behind the ports.
import { type AppError, ok, type Result } from "arp-domain";
import type { ClerkIdentity, ClerkOrgProvisioner, IdentityStore } from "../ports";
import type { UploadActor } from "./upload-report";

export interface ProvisionIdentityDeps {
  readonly identities: IdentityStore;
  readonly clerkOrgs: ClerkOrgProvisioner;
}

/** The scope a session-authenticated user holds on their own org (ADR-0039). */
const SELF_WRITE_SCOPE = "reports:write";

/** Display name for a user's personal org, derived from their email local-part. */
function personalOrgName(email: string): string {
  const local = email.split("@")[0]?.trim();
  return `${local && local.length > 0 ? local : "user"}'s workspace`;
}

export async function provisionIdentity(
  deps: ProvisionIdentityDeps,
  identity: ClerkIdentity,
): Promise<Result<UploadActor, AppError>> {
  const name = personalOrgName(identity.email);

  // 1. Ensure the user has an active Clerk org — create a personal one if not
  //    (Clerk doesn't auto-create them, ADR-0048).
  let clerkOrgId = identity.clerkOrgId;
  if (!clerkOrgId) {
    const created = await deps.clerkOrgs.createPersonalOrg(identity.clerkUserId, name);
    if (!created.ok) return created;
    clerkOrgId = created.value;
  }

  // 2. Find-or-create the mirrored identity (idempotent across requests).
  const found = await deps.identities.findByClerk(identity.clerkUserId, clerkOrgId);
  if (!found.ok) return found;

  let provisioned = found.value;
  if (!provisioned) {
    const created = await deps.identities.createPersonalIdentity({
      clerkUserId: identity.clerkUserId,
      clerkOrgId,
      email: identity.email,
      orgName: name,
    });
    if (!created.ok) return created;
    provisioned = created.value;
  }

  return ok({
    userId: provisioned.userId,
    orgId: provisioned.orgId,
    folderId: provisioned.rootFolderId,
    scopes: [SELF_WRITE_SCOPE],
  });
}
