// handleUserCreated — silent domain auto-join on Clerk's `user.created` webhook
// (ADR-0074). Clerk has no native silent auto-join (its forced org-selection
// task runs at sign-up, BEFORE first-write JIT provisioning ever sees the
// user), so this handler pre-grants the membership server-side the moment the
// user exists: by the time the forced task renders, the domain's org is
// already joined and the task becomes select-not-create.
//
// Personal (public-provider) addresses are a deliberate no-op — their org
// stays JIT-at-first-write (ADR-0048), because a personal org pre-created at
// sign-up would count against Clerk's retained-org pricing for users who never
// upload anything.
//
// Team addresses run the SAME resolveCanonicalTeamOrg chain first-write JIT
// uses (DB domain index → anchor scan → create), so the webhook and the write
// path can never disagree on the canonical org. Deviation from ADR-0048's
// first-write-only mirroring, recorded in ADR-0074: the ORG row is written
// here (under the free-plan architecture the DB row IS the join index, so it
// must exist before the next same-domain sign-up); the USER row still mirrors
// at first write.
//
// Idempotent end-to-end (Svix retries safely): every step is find-or-create /
// already-a-member-tolerant. Error contract for the webhook route:
//   - PlanLimitExceeded (membership cap) → permanent; ack + alert, don't retry.
//   - ValidationError (malformed email) → permanent; ack + warn.
//   - anything else → transient; 500 so Svix redelivers.
import { type AppError, ok, type Result, resolveOrgKey } from "arp-domain";
import {
  type ResolveTeamOrgDeps,
  resolveCanonicalTeamOrg,
  type TeamOrgOutcome,
} from "./resolve-team-org";

export type HandleUserCreatedDeps = ResolveTeamOrgDeps;

export interface HandleUserCreatedInput {
  /** The Clerk user id from the `user.created` event payload. */
  readonly clerkUserId: string;
  /** The user's primary VERIFIED email — the webhook route filters on
   *  verification before calling (an unverified address must never claim a
   *  domain, ADR-0068's verified-emails-only invariant). */
  readonly email: string;
}

export interface HandleUserCreatedResult {
  /** What happened: `personal-noop` (public-provider address — nothing to do),
   *  or the team-org resolution outcome (`joined` / `adopted` / `created`). */
  readonly outcome: "personal-noop" | TeamOrgOutcome;
}

export async function handleUserCreated(
  deps: HandleUserCreatedDeps,
  input: HandleUserCreatedInput,
): Promise<Result<HandleUserCreatedResult, AppError>> {
  const resolved = resolveOrgKey(input.email);
  if (!resolved.ok) return resolved;

  if (resolved.value.kind === "personal") return ok({ outcome: "personal-noop" });

  const team = await resolveCanonicalTeamOrg(deps, {
    domain: resolved.value.key,
    clerkUserId: input.clerkUserId,
  });
  if (!team.ok) return team;
  return ok({ outcome: team.value.outcome });
}
