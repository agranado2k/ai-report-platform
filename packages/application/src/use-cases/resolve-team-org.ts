// resolveCanonicalTeamOrg — the ONE way a team-domain user's canonical org is
// resolved (ADR-0074), shared by the `user.created` webhook handler
// (handle-user-created) and first-write JIT provisioning (provision-identity)
// so the two entry points can never diverge on which org a domain maps to.
//
// The chain, in order:
//   1. DB domain index (`orgs.domain`, the canonical join key — Clerk
//      organization-domains is 402-gated on the free plan):
//      hit → verify the Clerk org's `publicMetadata.domain` anchor (fail
//      closed — a mismatch is a tenant-boundary crossing) → ensureMembership.
//   2. Index miss → bounded Clerk anchor scan: an org for this domain may
//      exist in Clerk without a DB row (created before the index existed —
//      the House Numbers shape). Adopt it: record the org row (name from
//      Clerk, kind team, domain indexed) → ensureMembership.
//   3. No adoptable org → create the team org in Clerk (anchor stamped,
//      creator auto-admin) and record its row.
//
// Concurrency: Clerk-side creation has NO uniqueness (no slugs, no domains
// feature), so two racing first-sign-ups can both create. The partial unique
// index on `orgs.domain` is the race closer — the loser's row write returns
// Conflict, and we re-read the index and JOIN the winner instead. The loser's
// freshly-created Clerk org stays behind unreferenced (bounded blast radius:
// one empty org per lost race; accepted in ADR-0074).
//
// Idempotent end-to-end: every step is find-or-create / already-a-member-safe,
// so Svix retries and repeated sign-ins are no-ops.
import { type AppError, err, ok, type Result } from "arp-domain";
import type { ClerkOrgProvisioner, IdentityStore } from "../ports";

export interface ResolveTeamOrgDeps {
  readonly identities: Pick<IdentityStore, "findTeamOrgByDomain" | "upsertTeamOrg">;
  readonly clerkOrgs: Pick<
    ClerkOrgProvisioner,
    "verifyOrgAnchor" | "findOrgByAnchorScan" | "createTeamOrg" | "ensureMembership"
  >;
}

/** How the canonical org was resolved — `joined` (DB-index hit), `adopted`
 *  (unmirrored Clerk org found by anchor scan, row recorded), or `created`
 *  (first sign-up at the domain). */
export type TeamOrgOutcome = "joined" | "adopted" | "created";

export interface ResolvedTeamOrg {
  readonly clerkOrgId: string;
  /** The org's display name — Clerk's name on adopt (e.g. "House Numbers"),
   *  the domain itself on join/create. */
  readonly orgName: string;
  readonly outcome: TeamOrgOutcome;
}

export async function resolveCanonicalTeamOrg(
  deps: ResolveTeamOrgDeps,
  input: { readonly domain: string; readonly clerkUserId: string },
): Promise<Result<ResolvedTeamOrg, AppError>> {
  const domain = input.domain.toLowerCase();

  // 1. The DB domain index — the canonical join key.
  const indexed = await deps.identities.findTeamOrgByDomain(domain);
  if (!indexed.ok) return indexed;
  if (indexed.value) {
    return joinVerified(deps, domain, indexed.value.clerkOrgId, input.clerkUserId);
  }

  // 2. Index miss → adopt an existing unmirrored Clerk org by its anchor.
  const scanned = await deps.clerkOrgs.findOrgByAnchorScan(domain);
  if (!scanned.ok) return scanned;
  if (scanned.value) {
    const recorded = await deps.identities.upsertTeamOrg({
      clerkOrgId: scanned.value.clerkOrgId,
      name: scanned.value.name,
      domain,
    });
    if (!recorded.ok) {
      if (recorded.error.kind === "Conflict")
        return joinRaceWinner(deps, domain, input.clerkUserId);
      return recorded;
    }
    const joined = await deps.clerkOrgs.ensureMembership(
      scanned.value.clerkOrgId,
      input.clerkUserId,
    );
    if (!joined.ok) return joined;
    return ok({
      clerkOrgId: scanned.value.clerkOrgId,
      orgName: scanned.value.name,
      outcome: "adopted",
    });
  }

  // 3. Nothing anywhere → first sign-up at this domain creates the org.
  const created = await deps.clerkOrgs.createTeamOrg(domain, input.clerkUserId);
  if (!created.ok) return created;
  const recorded = await deps.identities.upsertTeamOrg({
    clerkOrgId: created.value,
    name: domain,
    domain,
  });
  if (!recorded.ok) {
    if (recorded.error.kind === "Conflict") return joinRaceWinner(deps, domain, input.clerkUserId);
    return recorded;
  }
  // The creator is auto-assigned org admin by Clerk — no membership call needed.
  return ok({ clerkOrgId: created.value, orgName: domain, outcome: "created" });
}

/** A DB-index hit (or the re-read after losing the row-write race): verify the
 *  Clerk org's anchor (fail closed), then idempotently join. */
async function joinVerified(
  deps: ResolveTeamOrgDeps,
  domain: string,
  clerkOrgId: string,
  clerkUserId: string,
): Promise<Result<ResolvedTeamOrg, AppError>> {
  const verified = await deps.clerkOrgs.verifyOrgAnchor(clerkOrgId, domain);
  if (!verified.ok) return verified;
  const joined = await deps.clerkOrgs.ensureMembership(clerkOrgId, clerkUserId);
  if (!joined.ok) return joined;
  return ok({ clerkOrgId, orgName: domain, outcome: "joined" });
}

/** We lost the concurrent row-write race (Conflict on orgs_domain_uniq): the
 *  index now names a winner — re-read and join it. A miss here means the
 *  winner vanished between the Conflict and the re-read (deleted row?) —
 *  surface loudly rather than looping. */
async function joinRaceWinner(
  deps: ResolveTeamOrgDeps,
  domain: string,
  clerkUserId: string,
): Promise<Result<ResolvedTeamOrg, AppError>> {
  const winner = await deps.identities.findTeamOrgByDomain(domain);
  if (!winner.ok) return winner;
  if (!winner.value) {
    return err({
      kind: "Unexpected",
      message: `lost the domain-index race for "${domain}" but no winner row exists — retry`,
    });
  }
  return joinVerified(deps, domain, winner.value.clerkOrgId, clerkUserId);
}
