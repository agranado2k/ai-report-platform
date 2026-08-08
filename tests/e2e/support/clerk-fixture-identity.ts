// The IDENTITY CONTRACT for this repo's Clerk e2e fixtures: which addresses
// the suite mints for itself, which addresses it must never touch, and the
// pure predicates a sweep uses to tell the two apart.
//
// Pure by construction — no `fetch`, no `process`, no `node:fs`. The Backend
// API shell that acts on these verdicts lives in `clerk-fixture-sweep.ts`;
// everything that decides WHAT gets deleted lives here and is pinned by
// `clerk-fixture-identity.test.ts` in the fast node-tier gate. A sweep is a
// DELETE loop pointed at a shared instance that also holds the operator's own
// account, so the predicate is the safety mechanism, not the plumbing.
//
// ISSUE #266 — WHY A SWEEP EXISTS. Run-scoped identities leaked into the
// shared Clerk dev instance until the anchored `agranado.com` team org hit its
// membership cap and the preview smoke — a merge-REQUIRED check — began
// failing 402 `plan_limit_exceeded` on the FIRST identity of every run. The
// leak is self-reinforcing: once the org is near cap, provisioning throws
// mid-way, which orphans another user, which fills the cap faster.

/** The corporate domain the team-org scenarios exercise (NOT on the
 *  public-provider list, so it resolves to a `team` org — ADR-0068 §1). */
export const TEAM_ORG_DOMAIN = "agranado.com";

/** ADR-0068 §6 — the hand-provisioned second identity (Clerk test-mode address,
 *  verification code 424242). See `tests/e2e/README.md`. NOT run-scoped: it is
 *  standing fixture data, and a sweep that deletes it breaks the suite. */
export const SECOND_FIXTURE_EMAIL = "silver+clerk_test@agranado.com";

/** A RUN-SCOPED team-fixture address (ADR-0074 shared-team-org scenario):
 *  `<prefix>-<runId>+clerk_test@agranado.com`. Fresh identities per run are
 *  the contamination fix from PR #222 round 3: a REUSED fixture can carry a
 *  poisoned mirror from an earlier run / older code in the (persistent,
 *  prod-forked) preview DB branch, and ADR-0074's sticky-after-mirror policy
 *  then CORRECTLY honors that mirror forever — masking the canonical chain
 *  this scenario exists to prove. A user that didn't exist before this run
 *  cannot be mirrored anywhere, on any branch state. Keeps `+clerk_test`
 *  (test-mode: no real inbox, code 424242) and the team domain. */
export function runScopedTeamEmail(prefix: string, runId: string): string {
  return `${prefix}-${runId}+clerk_test@${TEAM_ORG_DOMAIN}`;
}

/**
 * The one regex that decides whether an address is disposable e2e litter.
 *
 * **KEEP BYTE-IDENTICAL to `RUN_SCOPED_EMAIL_PATTERN` in
 * `.github/workflows/clerk-sweep.yml`.** That workflow is bash + curl + jq and
 * cannot import this module, so it embeds this exact string; a test pins the
 * literal here precisely so changing it fails loudly and prompts the paired
 * edit. jq's `test()` (Oniguruma) and JS's `RegExp` agree on every construct
 * used below.
 *
 * Read it as the three things that must ALL hold:
 *   - `[a-z]{3,12}-`   a scenario prefix (silver / gold / bronze / fsown /
 *                      fscol today) followed by a hyphen. A human local part
 *                      like `support` has no hyphen; `a-b` has too short a
 *                      prefix.
 *   - `[0-9a-z]{8,16}` the run id — `Date.now().toString(36)` (8 chars until
 *                      ~2059) plus 4 random base-36 chars. This length floor
 *                      is what keeps `john-smith+clerk_test@…` out.
 *   - `\+clerk_test@agranado\.com` the Clerk TEST-MODE marker on the team
 *                      domain, anchored at both ends. A `+clerk_test` address
 *                      cannot be a real inbox on a live instance at all.
 */
export const RUN_SCOPED_EMAIL_PATTERN_SOURCE =
  "^[a-z]{3,12}-[0-9a-z]{8,16}\\+clerk_test@agranado\\.com$";

const RUN_SCOPED_EMAIL_PATTERN = new RegExp(RUN_SCOPED_EMAIL_PATTERN_SOURCE);

/** Addresses a sweep must refuse even if some future pattern edit would accept
 *  them. Belt-and-braces over the regex, not a replacement for it — callers add
 *  `E2E_TEST_USER_EMAIL` (the primary fixture) at runtime, since its value is
 *  configuration rather than a literal. */
export const NEVER_SWEEP_EMAILS: readonly string[] = [SECOND_FIXTURE_EMAIL];

/** The minimum age a run-scoped identity must reach before an OPPORTUNISTIC
 *  sweep (global setup / global teardown) will delete it. Simultaneous PR runs
 *  share this Clerk instance — that contention is half of issue #266 — so an
 *  un-gated sweep would delete a concurrent run's live identities mid-scenario.
 *  A full CI run is minutes; 24h is far past any of them. */
export const SWEEP_MIN_AGE_HOURS = 24;

/** The name `ensureTeamFixtureUser` gives the pending-session-heal decoy org. */
export const DECOY_ORG_NAME_PREFIX = "arp-e2e-decoy-";

function normalize(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Is this address one THIS SUITE minted for a single CI run, and therefore
 * safe to delete?
 *
 * `neverSweep` wins over the pattern in every case — pass the primary
 * fixture's configured address (and anything else that must survive) here.
 */
export function isRunScopedFixtureEmail(
  email: string | null | undefined,
  neverSweep: readonly string[] = NEVER_SWEEP_EMAILS,
): boolean {
  const normalized = normalize(email);
  if (normalized === null) return false;
  if (neverSweep.some((protectedEmail) => normalize(protectedEmail) === normalized)) return false;
  return RUN_SCOPED_EMAIL_PATTERN.test(normalized);
}

/**
 * Is this org the anchorless decoy minted for a run-scoped identity?
 *
 * Deleting a Clerk user does NOT delete an organization that user created, so
 * every leaked identity also leaves a decoy behind. The name is
 * `arp-e2e-decoy-<local part of the fixture email>`, so the decision reduces to
 * the email predicate above — one rule, not two.
 */
export function isRunScopedDecoyOrgName(
  name: string | null | undefined,
  neverSweep: readonly string[] = NEVER_SWEEP_EMAILS,
): boolean {
  const normalized = normalize(name);
  if (normalized === null || !normalized.startsWith(DECOY_ORG_NAME_PREFIX)) return false;
  const localPart = normalized.slice(DECOY_ORG_NAME_PREFIX.length);
  if (localPart.length === 0) return false;
  return isRunScopedFixtureEmail(`${localPart}@${TEAM_ORG_DOMAIN}`, neverSweep);
}

export interface SweepWindow {
  /** `Date.now()` at the caller — injected so the age gate is testable. */
  readonly nowMs: number;
  /** Only take identities at least this old. `0` takes every run-scoped one. */
  readonly olderThanHours: number;
  /** Extra addresses that must survive, on top of `NEVER_SWEEP_EMAILS`. */
  readonly neverSweep?: readonly string[];
}

/** A Clerk user, reduced to what the decision needs. */
export interface SweepableUser {
  readonly id: string;
  readonly email: string | null | undefined;
  /** Clerk's `created_at` (ms epoch). `NaN` when the API omitted it. */
  readonly createdAtMs: number;
}

/** A Clerk organization, reduced to what the decision needs. */
export interface SweepableOrganization {
  readonly id: string;
  readonly name: string | null | undefined;
  readonly createdAtMs: number;
}

const HOUR_MS = 60 * 60 * 1000;

/** Age gate. An identity with no usable `created_at` is only ever taken when
 *  age is not being gated at all — the safe direction is to leave it alone and
 *  let the next explicit sweep (`older_than_hours: 0`) collect it. */
function isOldEnough(createdAtMs: number, sweepWindow: SweepWindow): boolean {
  if (sweepWindow.olderThanHours <= 0) return true;
  if (!Number.isFinite(createdAtMs)) return false;
  return sweepWindow.nowMs - createdAtMs >= sweepWindow.olderThanHours * HOUR_MS;
}

function protectedAddresses(sweepWindow: SweepWindow): readonly string[] {
  return sweepWindow.neverSweep
    ? [...NEVER_SWEEP_EMAILS, ...sweepWindow.neverSweep]
    : NEVER_SWEEP_EMAILS;
}

/** The users a sweep may delete: run-scoped by address AND past the age gate. */
export function selectSweepableUsers<T extends SweepableUser>(
  users: readonly T[],
  sweepWindow: SweepWindow,
): readonly T[] {
  const neverSweep = protectedAddresses(sweepWindow);
  return users.filter(
    (user) =>
      isRunScopedFixtureEmail(user.email, neverSweep) && isOldEnough(user.createdAtMs, sweepWindow),
  );
}

/** The decoy orgs a sweep may delete — same two gates as the users. */
export function selectSweepableOrganizations<T extends SweepableOrganization>(
  organizations: readonly T[],
  sweepWindow: SweepWindow,
): readonly T[] {
  const neverSweep = protectedAddresses(sweepWindow);
  return organizations.filter(
    (org) =>
      isRunScopedDecoyOrgName(org.name, neverSweep) && isOldEnough(org.createdAtMs, sweepWindow),
  );
}
