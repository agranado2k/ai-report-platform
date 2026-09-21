// The Backend-API SHELL that acts on `clerk-fixture-identity.ts`'s verdicts.
//
// Deliberately thin: it lists, it hands the page to a pure selector, it
// deletes, it reports. Every decision about WHAT may be deleted lives in the
// pure module and is unit-tested there; nothing in this file chooses a victim.
//
// Two cleanup paths, both tolerant of partial failure:
//
//   1. `purgeRegisteredIdentities` — delete exactly what THIS run recorded
//      (`clerk-fixture-registry.ts`), including objects created by a
//      provisioning call that threw before returning. Precise: no age gate is
//      needed because these ids are ours by construction.
//
//   2. `sweepStaleRunScopedIdentities` — the self-healing pass. Deletes
//      run-scoped identities older than `SWEEP_MIN_AGE_HOURS` anywhere on the
//      instance, so litter from a job that was cancelled or killed (where no
//      teardown of any kind runs) is collected by the next run instead of
//      accumulating until the org hits its membership cap. The age gate is
//      what makes it safe to run while OTHER PRs are mid-smoke on the same
//      shared instance.
//
// Neither ever throws. A cleanup that fails a run it was trying to protect is
// worse than the leak; loud warnings plus the sweep workflow
// (.github/workflows/clerk-sweep.yml) are the escalation path.
import { clerkFetch, deleteClerkObject } from "./clerk-backend-api";
import {
  assessAnchoredOrgCap,
  type OrgCapState,
  SWEEP_MIN_AGE_HOURS,
  type SweepableOrganization,
  type SweepableUser,
  selectSweepableOrganizations,
  selectSweepableUsers,
} from "./clerk-fixture-identity";
import {
  type RegisteredIdentity,
  readProvisionedIdentities,
  resetProvisionedIdentities,
} from "./clerk-fixture-registry";

const PAGE_LIMIT = 100;
/** 2 000 objects. A test instance that exceeds this needs the sweep workflow,
 *  not a longer loop inside a test run's teardown. */
const MAX_PAGES = 20;

export interface CleanupSummary {
  readonly deleted: readonly string[];
  readonly failed: readonly string[];
}

const EMPTY: CleanupSummary = { deleted: [], failed: [] };

function merge(a: CleanupSummary, b: CleanupSummary): CleanupSummary {
  return { deleted: [...a.deleted, ...b.deleted], failed: [...a.failed, ...b.failed] };
}

function pathFor(kind: RegisteredIdentity["kind"], id: string): string {
  return kind === "user" ? `/users/${id}` : `/organizations/${id}`;
}

/** A Clerk numeric field (a `created_at` ms epoch, a `total_count`, a
 *  `max_allowed_memberships`); anything non-numeric becomes NaN, which the pure
 *  gates read as "unknown" and refuse to decide on. */
function asNumber(value: unknown): number {
  return typeof value === "number" ? value : Number.NaN;
}

async function deleteAll(
  secretKey: string,
  targets: readonly {
    readonly kind: RegisteredIdentity["kind"];
    readonly id: string;
    readonly label: string;
  }[],
): Promise<CleanupSummary> {
  const deleted: string[] = [];
  const failed: string[] = [];

  for (const target of targets) {
    const outcome = await deleteClerkObject(secretKey, pathFor(target.kind, target.id));
    if (outcome.ok) deleted.push(`${target.kind} ${target.label} (${target.id})`);
    else failed.push(`${target.kind} ${target.label} (${target.id}): ${outcome.reason}`);
  }

  return { deleted, failed };
}

/** `GET /users` answers a bare ARRAY (unlike `/organizations`, which wraps in
 *  `{ data }`) — the same shape `clerk-session.ts` already relies on. */
export async function listAllUsers(secretKey: string): Promise<readonly SweepableUser[]> {
  const users: SweepableUser[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await clerkFetch(
      `/users?limit=${PAGE_LIMIT}&offset=${page * PAGE_LIMIT}&order_by=-created_at`,
      secretKey,
    );
    if (!res.ok) throw new Error(`clerk users listing failed: ${res.status}`);
    const body = (await res.json()) as ReadonlyArray<{
      id: string;
      created_at?: unknown;
      email_addresses?: ReadonlyArray<{ email_address?: unknown }>;
    }>;
    if (!Array.isArray(body)) throw new Error("clerk users listing returned a non-array body");

    for (const user of body) {
      const email = user.email_addresses?.[0]?.email_address;
      users.push({
        id: user.id,
        email: typeof email === "string" ? email : null,
        createdAtMs: asNumber(user.created_at),
      });
    }
    if (body.length < PAGE_LIMIT) break;
  }

  return users;
}

export async function listAllOrganizations(
  secretKey: string,
): Promise<readonly SweepableOrganization[]> {
  const organizations: SweepableOrganization[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await clerkFetch(
      `/organizations?limit=${PAGE_LIMIT}&offset=${page * PAGE_LIMIT}`,
      secretKey,
    );
    if (!res.ok) throw new Error(`clerk organizations listing failed: ${res.status}`);
    const body = (await res.json()) as {
      data?: ReadonlyArray<{ id: string; name?: unknown; created_at?: unknown }>;
    };
    const pageItems = body.data ?? [];

    for (const org of pageItems) {
      organizations.push({
        id: org.id,
        name: typeof org.name === "string" ? org.name : null,
        createdAtMs: asNumber(org.created_at),
      });
    }
    if (pageItems.length < PAGE_LIMIT) break;
  }

  return organizations;
}

/**
 * Delete every Clerk object this run recorded, then drop the ledger.
 *
 * The per-scenario `After` hooks have usually already deleted most of these —
 * that is fine and expected, since a 404 counts as success. What this adds is
 * the objects NO hook could see: the ones created by a provisioning call that
 * threw before it returned.
 */
export async function purgeRegisteredIdentities(secretKey: string): Promise<CleanupSummary> {
  const recorded = readProvisionedIdentities();
  if (recorded.length === 0) return EMPTY;

  // Users before organizations: an org whose creator is already gone is still
  // deletable, and doing users first frees the memberships that matter.
  const users = recorded.filter((entry) => entry.kind === "user");
  const organizations = recorded.filter((entry) => entry.kind === "organization");
  const summary = merge(
    await deleteAll(secretKey, users),
    await deleteAll(secretKey, organizations),
  );

  if (summary.failed.length === 0) resetProvisionedIdentities();
  return summary;
}

export interface SweepOptions {
  /** Defaults to `SWEEP_MIN_AGE_HOURS` — never 0 by accident. */
  readonly olderThanHours?: number;
  readonly nowMs?: number;
  /** Addresses that must survive on top of the built-in list — the caller
   *  passes `E2E_TEST_USER_EMAIL`, whose value is configuration. */
  readonly neverSweep?: readonly string[];
}

/**
 * The opportunistic, self-healing pass: delete run-scoped identities (and their
 * decoy orgs) older than the age gate, wherever they are on the instance.
 *
 * Age-gated by default precisely because simultaneous PR runs share this
 * instance. Never widen the default to 0 here — that is the sweep workflow's
 * job, behind an explicit `workflow_dispatch` and a dry run.
 */
export async function sweepStaleRunScopedIdentities(
  secretKey: string,
  options: SweepOptions = {},
): Promise<CleanupSummary> {
  const sweepWindow = {
    nowMs: options.nowMs ?? Date.now(),
    olderThanHours: options.olderThanHours ?? SWEEP_MIN_AGE_HOURS,
    neverSweep: options.neverSweep,
  };

  const users = selectSweepableUsers(await listAllUsers(secretKey), sweepWindow);
  const organizations = selectSweepableOrganizations(
    await listAllOrganizations(secretKey),
    sweepWindow,
  );

  return merge(
    await deleteAll(
      secretKey,
      users.map((user) => ({ kind: "user" as const, id: user.id, label: user.email ?? user.id })),
    ),
    await deleteAll(
      secretKey,
      organizations.map((org) => ({
        kind: "organization" as const,
        id: org.id,
        label: org.name ?? org.id,
      })),
    ),
  );
}

/**
 * Read the anchored org's membership state from the Backend API (issue #372).
 *
 * `max_allowed_memberships` is always present on the Organization object;
 * `total_count` on the memberships listing is the org's total member count,
 * independent of paging (both verified against the Clerk BAPI spec 2026-05-12).
 * We ask for a single membership only — we want the count, not the page.
 */
export async function fetchAnchoredOrgCapState(
  secretKey: string,
  orgId: string,
): Promise<OrgCapState> {
  const orgRes = await clerkFetch(`/organizations/${orgId}`, secretKey);
  if (!orgRes.ok) throw new Error(`clerk organization lookup failed: ${orgRes.status}`);
  const org = (await orgRes.json()) as { max_allowed_memberships?: unknown };

  const membersRes = await clerkFetch(`/organizations/${orgId}/memberships?limit=1`, secretKey);
  if (!membersRes.ok) throw new Error(`clerk memberships lookup failed: ${membersRes.status}`);
  const memberships = (await membersRes.json()) as { total_count?: unknown };

  return {
    membersCount: asNumber(memberships.total_count),
    maxAllowedMemberships: asNumber(org.max_allowed_memberships),
  };
}

/**
 * Fail-fast BEFORE provisioning if the anchored org lacks headroom for the
 * smoke's footprint (issue #372) — turning a confusing mid-suite `402
 * plan_limit_exceeded` into an obvious, actionable setup failure.
 *
 * Only a CONFIRMED shortfall throws. If the cap state cannot be determined (a
 * transient 429/5xx, a missing field), this logs and RETURNS: a false setup
 * failure is worse than deferring to the real 402 the run would otherwise hit.
 * The decision itself lives in the pure, unit-tested `assessAnchoredOrgCap`.
 */
export async function preflightAnchoredOrgCap(
  secretKey: string,
  orgId: string,
  footprint: number,
): Promise<void> {
  let state: OrgCapState;
  try {
    state = await fetchAnchoredOrgCapState(secretKey, orgId);
  } catch (error) {
    console.warn(
      `clerk cap preflight skipped — ${String(error)}. Proceeding; a genuine cap shortfall will ` +
        "surface as the run's own 402.",
    );
    return;
  }

  const verdict = assessAnchoredOrgCap(state, footprint);
  if (!verdict.ok) throw new Error(verdict.reason ?? "anchored org membership cap exceeded");
}

/** The addresses a sweep run from inside the e2e process must never touch. */
export function configuredNeverSweep(): readonly string[] {
  const primary = process.env.E2E_TEST_USER_EMAIL;
  return primary ? [primary] : [];
}

/** Shared reporting for the two global hooks — one line per outcome, never a
 *  throw, and a loud pointer to the workflow when something is left behind. */
export function reportCleanup(context: string, summary: CleanupSummary): void {
  for (const line of summary.deleted) console.log(`${context}: deleted ${line}`);
  if (summary.failed.length > 0) {
    console.warn(
      `${context}: ${summary.failed.length} object(s) could NOT be deleted and will consume the ` +
        "shared Clerk org's membership cap until swept — run the `Clerk dev-instance sweep` " +
        `workflow (.github/workflows/clerk-sweep.yml). ${summary.failed.join("; ")}`,
    );
  }
}
