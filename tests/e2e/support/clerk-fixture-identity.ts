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

/**
 * The age gate a PRE-RUN sweep should use, given whether it runs in the
 * serialized-CI smoke (issue #372).
 *
 * The 24h default exists ONLY to protect a CONCURRENT run's live identities:
 * simultaneous PR smokes share this dev instance, so an un-gated opportunistic
 * sweep would delete another run's fixtures mid-scenario. But the `smoke` job's
 * `preview-smoke-shared` concurrency group (`cancel-in-progress: false`,
 * `.github/workflows/preview-isolation.yml`) guarantees no other smoke runs at
 * the same time — so THERE the age gate protects nothing and instead lets a
 * straggler survive: GitHub keeps only one pending run per group, so a third PR
 * EVICTS the second's queued smoke, and an evicted/SIGKILL'd run leaves its
 * run-scoped members behind with no teardown. Those stragglers are younger than
 * 24h, stack onto the next run's footprint, and tip the low membership cap →
 * `402 plan_limit_exceeded`. In the serialized context, sweep at age 0 to take
 * every straggler; everywhere else (a local/dev `pnpm e2e`) keep the safe
 * default so a sweep can never nuke a colleague's live run.
 */
export function preRunSweepAgeHours(serializedSmoke: boolean): number {
  return serializedSmoke ? 0 : SWEEP_MIN_AGE_HOURS;
}

/** The name `ensureTeamFixtureUser` gives the pending-session-heal decoy org. */
export const DECOY_ORG_NAME_PREFIX = "arp-e2e-decoy-";

/** The canonical `agranado.com` team org (ADR-0074) — the shared, domain-anchored
 *  org every run-scoped fixture JIT-joins, and the one whose membership cap the
 *  leak fills. Its id is ALSO hard-coded as `ORG_ID` in
 *  `.github/workflows/clerk-sweep.yml`; a unit test pins this literal so the two
 *  cannot drift silently (same discipline as `RUN_SCOPED_EMAIL_PATTERN_SOURCE`).
 *  This is the one org a sweep must NEVER delete. */
export const ANCHORED_TEAM_ORG_ID = "org_3HK9gdegaQZ1qdkGPgN3RGOTWVO";

/** The peak number of NEW run-scoped members one full `pnpm e2e` smoke joins
 *  into the anchored org: silver/gold/bronze (`team-org-upload.feature`, 3) plus
 *  fsown/fscol (`folder-sharing.feature`, 2) — both `@smoke @auth`, so both run
 *  in CI. The pre-provision preflight uses this as the headroom the org must
 *  have after the pre-run sweep. */
export const SMOKE_RUN_SCOPED_FOOTPRINT = 5;

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

/** The anchored org's membership state, reduced to what the preflight decides
 *  on. `maxAllowedMemberships` is Clerk's `max_allowed_memberships`;
 *  `membersCount` is the memberships list's `total_count` (both verified against
 *  the Clerk Backend API spec, 2026-05-12). */
export interface OrgCapState {
  readonly membersCount: number;
  readonly maxAllowedMemberships: number;
}

/** A preflight verdict — `ok` with `reason: null`, or a block with a
 *  human-actionable `reason`. */
export interface CapVerdict {
  readonly ok: boolean;
  readonly reason: string | null;
}

const CAP_OK: CapVerdict = { ok: true, reason: null };

/**
 * Would provisioning `footprint` more members overflow the anchored org's cap?
 *
 * Fail-fast, but only on a CONFIRMED shortfall. A non-positive cap is treated
 * as unknown/unlimited (Clerk's "0 = unlimited" is undocumented for this field,
 * so we do not rely on it either way), and a non-finite count is undeterminable
 * — in both cases we pass rather than block, because a false setup failure is
 * worse than deferring to the real 402 the run would otherwise hit. When the
 * numbers ARE known and headroom is below the footprint, block with a message
 * that names the members remaining, the cap and the footprint — turning a
 * confusing mid-suite 402 into an obvious, actionable setup failure.
 */
export function assessAnchoredOrgCap(state: OrgCapState, footprint: number): CapVerdict {
  const { membersCount, maxAllowedMemberships } = state;
  if (!Number.isFinite(membersCount) || !Number.isFinite(maxAllowedMemberships)) return CAP_OK;
  if (maxAllowedMemberships <= 0) return CAP_OK;

  const headroom = maxAllowedMemberships - membersCount;
  if (headroom >= footprint) return CAP_OK;

  return {
    ok: false,
    reason:
      `anchored org at membership cap after pre-run sweep — ${membersCount} member(s) remain of a ` +
      `${maxAllowedMemberships} cap (${headroom} free), insufficient headroom for the smoke's ` +
      `footprint of ${footprint}. Investigate leaked run-scoped identities (Actions → "Clerk ` +
      `dev-instance sweep") or raise the cap.`,
  };
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
