// provisionIdentity — resolve a Clerk identity into our UploadActor, creating the
// mirror (User + Org + Root folder) on first sight (ADR-0048, extended by
// ADR-0068). Pure orchestration over the IdentityStore + ClerkOrgProvisioner
// ports (ADR-0024): the policy — derive the org key from the email's domain
// (ADR-0068 §1), then join-or-create the right Clerk org and find-or-create the
// mirror — lives here; all I/O is behind the ports.
import { type AppError, ok, type Result, resolveOrgKey } from "arp-domain";
import type { ClerkIdentity, ClerkOrgProvisioner, IdentityStore } from "../ports";
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

export async function provisionIdentity(
  deps: ProvisionIdentityDeps,
  identity: ClerkIdentity,
): Promise<Result<UploadActor, AppError>> {
  // 0. Derive the ONE org this user belongs to from their email (ADR-0068 §1):
  //    a public-provider address → `personal` (keyed by the full address,
  //    ADR-0048's original 1:1 model, unchanged); any other domain → that
  //    domain's `team` org (multi-member by design). This also decides the
  //    Org's display name and — on first mirror — its `kind` column.
  const resolved = resolveOrgKey(identity.email);
  if (!resolved.ok) return resolved;
  const { kind, key } = resolved.value;
  const orgName: string = kind === "personal" ? personalOrgName(identity.email) : key; // key = the domain for a team org

  // 1. Ensure the user has an active Clerk org. A session already carrying one
  //    is trusted as-is (the one-user-one-org invariant means it can only be
  //    correct — ADR-0068 §1's "org-mode unlock is correct by construction").
  //    Otherwise, join-or-create by kind:
  //      - personal: create (or reuse, idempotently) the user's own org.
  //      - team: find the domain's existing org and join it, or create it as
  //        the domain's first sign-up (ADR-0068 §3).
  let clerkOrgId: string | null = identity.clerkOrgId;
  if (!clerkOrgId) {
    if (kind === "personal") {
      const created = await deps.clerkOrgs.createPersonalOrg(identity.clerkUserId, orgName);
      if (!created.ok) return created;
      clerkOrgId = created.value;
    } else {
      const existing = await deps.clerkOrgs.findTeamOrgByDomain(key);
      if (!existing.ok) return existing;
      if (existing.value) {
        clerkOrgId = existing.value;
        const joined = await deps.clerkOrgs.ensureMembership(clerkOrgId, identity.clerkUserId);
        if (!joined.ok) return joined;
      } else {
        const created = await deps.clerkOrgs.createTeamOrg(key, identity.clerkUserId);
        if (!created.ok) return created;
        clerkOrgId = created.value; // first member — Clerk auto-assigns org admin
      }
    }
  }

  // 2. Find-or-create the mirrored identity (idempotent across requests). The
  //    Org row itself is a find-or-create keyed on `clerkOrgId` (a second
  //    colleague joining a team org reuses the SAME Org + Root folder, ADR-0068
  //    §3); `kind` only takes effect on the Org's first creation.
  const found = await deps.identities.findByClerk(identity.clerkUserId, clerkOrgId);
  if (!found.ok) return found;

  let provisioned = found.value;
  if (!provisioned) {
    const created = await deps.identities.createIdentity({
      clerkUserId: identity.clerkUserId,
      clerkOrgId,
      email: identity.email,
      orgName,
      kind,
    });
    if (!created.ok) return created;
    provisioned = created.value;
  }

  return ok({
    userId: provisioned.userId,
    orgId: provisioned.orgId,
    folderId: provisioned.rootFolderId,
    scopes: SELF_SCOPES,
  });
}
