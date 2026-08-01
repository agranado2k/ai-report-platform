// provisionIdentity — resolve a Clerk identity into our UploadActor, creating the
// mirror (User + Org + Root folder) on first sight (ADR-0048, extended by
// ADR-0068, re-keyed by ADR-0074). Pure orchestration over the IdentityStore +
// ClerkOrgProvisioner ports (ADR-0024): the policy — derive the org key from the
// email's domain (ADR-0068 §1), then join-or-create the right Clerk org and
// find-or-create the mirror — lives here; all I/O is behind the ports.
import { type AppError, ok, type Result, resolveOrgKey } from "arp-domain";
import type {
  ClerkIdentity,
  ClerkOrgProvisioner,
  IdentityStore,
  ProvisionedIdentity,
} from "../ports";
import { resolveCanonicalTeamOrg } from "./resolve-team-org";
import type { UploadActor } from "./upload-report";

export interface ProvisionIdentityDeps {
  readonly identities: IdentityStore;
  readonly clerkOrgs: ClerkOrgProvisioner;
}

/** The scopes a session-authenticated user holds on their own org (ADR-0039): full
 *  control of their own reports, including sharing config (`acl:write`, ADR-0056).
 *  Exported so the read-path actor resolver (`resolveActorForRead`) can grant the
 *  same scopes to a session/OAuth read — a browser/MCP-OAuth caller isn't
 *  API-key-scoped, so it holds full access on both the read and write path
 *  (ADR-0060 §3 — `listWriteGrants` needs `acl:write` on the read path too). */
export const SELF_SCOPES = ["reports:write", "acl:write"];

/** Display name for a user's personal org, derived from their email local-part. */
function personalOrgName(email: string): string {
  const local = email.split("@")[0]?.trim();
  return `${local && local.length > 0 ? local : "user"}'s workspace`;
}

function toActor(provisioned: ProvisionedIdentity): UploadActor {
  return {
    userId: provisioned.userId,
    orgId: provisioned.orgId,
    folderId: provisioned.rootFolderId,
    scopes: SELF_SCOPES,
  };
}

export async function provisionIdentity(
  deps: ProvisionIdentityDeps,
  identity: ClerkIdentity,
): Promise<Result<UploadActor, AppError>> {
  // 0. Derive the ONE org this user belongs to from their email (ADR-0068 §1):
  //    a public-provider address → `personal` (keyed by the full address,
  //    ADR-0048's original 1:1 model, unchanged); any other domain → that
  //    domain's `team` org (multi-member by design).
  const resolved = resolveOrgKey(identity.email);
  if (!resolved.ok) return resolved;
  const { kind, key } = resolved.value;

  if (kind === "personal") return provisionPersonal(deps, identity);
  return provisionTeam(deps, identity, key);
}

/** The original ADR-0048 personal flow, unchanged: a session already carrying
 *  an org is trusted as-is (personal orgs are 1:1 — it can only be the user's
 *  own), otherwise create (or idempotently reuse) the user's personal org. */
async function provisionPersonal(
  deps: ProvisionIdentityDeps,
  identity: ClerkIdentity,
): Promise<Result<UploadActor, AppError>> {
  const orgName = personalOrgName(identity.email);
  let clerkOrgId: string | null = identity.clerkOrgId;
  if (!clerkOrgId) {
    const created = await deps.clerkOrgs.createPersonalOrg(identity.clerkUserId, orgName);
    if (!created.ok) return created;
    clerkOrgId = created.value;
  }

  const found = await deps.identities.findByClerk(identity.clerkUserId, clerkOrgId);
  if (!found.ok) return found;
  if (found.value) return ok(toActor(found.value));

  const created = await deps.identities.createIdentity({
    clerkUserId: identity.clerkUserId,
    clerkOrgId,
    email: identity.email,
    displayName: identity.displayName,
    orgName,
    kind: "personal",
  });
  if (!created.ok) return created;
  return ok(toActor(created.value));
}

/** The team flow (ADR-0074): the session's active org is honored ONLY when the
 *  (user, org) pair is already mirrored — "sticky-after-mirror". ADR-0068's
 *  blanket session-org trust was the hole that let Clerk's forced
 *  org-selection task (which runs BEFORE our provisioning ever sees the user)
 *  park a second same-domain user in a self-created duplicate org: whatever
 *  org the session carried short-circuited the domain resolution entirely. On
 *  a mirror miss the session org is now IGNORED and the canonical org is
 *  resolved by domain — DB index → anchor scan → create (the shared
 *  resolveCanonicalTeamOrg chain, same as the `user.created` webhook) — then
 *  mirrored; the mirror write records/heals the `orgs.domain` index too. Once
 *  mirrored, the user's org never re-keys (ADR-0068's sticky-membership rule,
 *  unchanged). */
async function provisionTeam(
  deps: ProvisionIdentityDeps,
  identity: ClerkIdentity,
  domain: string,
): Promise<Result<UploadActor, AppError>> {
  if (identity.clerkOrgId) {
    const mirrored = await deps.identities.findByClerk(identity.clerkUserId, identity.clerkOrgId);
    if (!mirrored.ok) return mirrored;
    if (mirrored.value) return ok(toActor(mirrored.value)); // sticky-after-mirror
  }

  const canonical = await resolveCanonicalTeamOrg(deps, {
    domain,
    clerkUserId: identity.clerkUserId,
  });
  if (!canonical.ok) return canonical;

  // Find-or-create the mirror against the CANONICAL org (idempotent across
  // requests; a second colleague reuses the same Org row + Root folder,
  // ADR-0068 §3). `domain` rides along so the org row is indexed/healed even
  // on the find-or-create path (ADR-0074 set-domain-if-null).
  const found = await deps.identities.findByClerk(identity.clerkUserId, canonical.value.clerkOrgId);
  if (!found.ok) return found;
  if (found.value) return ok(toActor(found.value));

  const created = await deps.identities.createIdentity({
    clerkUserId: identity.clerkUserId,
    clerkOrgId: canonical.value.clerkOrgId,
    email: identity.email,
    displayName: identity.displayName,
    orgName: canonical.value.orgName,
    kind: "team",
    domain,
  });
  if (!created.ok) return created;
  return ok(toActor(created.value));
}
