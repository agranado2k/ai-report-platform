// Unit coverage for the run-scoped e2e identity CONTRACT
// (tests/e2e/support/clerk-fixture-identity.ts).
//
// THE FAILURE IT EXISTS TO STOP (issue #266). Run-scoped identities leaked into
// the shared Clerk dev instance until the anchored `agranado.com` team org hit
// its membership cap and every smoke run started failing 402
// `plan_limit_exceeded` — a merge-REQUIRED check, so the whole repo's pipeline
// stopped. The repair is a sweep: find the leaked identities and delete them.
//
// A sweep is a DELETE loop pointed at a shared Clerk instance that also holds
// the hand-provisioned fixtures and the operator's own account. The predicate
// deciding what it touches is therefore the single most dangerous function in
// the e2e support layer, and it is the one thing here that is pure — so every
// branch of it is pinned in the fast node-tier gate rather than discovered
// against a live instance. The negative cases are the point: a real-looking
// `@agranado.com` address, and the hand-provisioned NON-run-scoped fixture,
// must never match, in any casing.
import { describe, expect, it } from "vitest";
import {
  ANCHORED_TEAM_ORG_ID,
  assessAnchoredOrgCap,
  isRunScopedDecoyOrgName,
  isRunScopedFixtureEmail,
  NEVER_SWEEP_EMAILS,
  preRunSweepAgeHours,
  RUN_SCOPED_EMAIL_PATTERN_SOURCE,
  runScopedTeamEmail,
  SECOND_FIXTURE_EMAIL,
  SMOKE_RUN_SCOPED_FOOTPRINT,
  SWEEP_MIN_AGE_HOURS,
  selectSweepableOrganizations,
  selectSweepableUsers,
  TEAM_ORG_DOMAIN,
} from "./clerk-fixture-identity";

/** The run-id generator the step files use, reproduced exactly — see
 *  `RUN_ID` in tests/e2e/smoke/team-org-upload.steps.ts and
 *  tests/e2e/features/folder-sharing.steps.ts. */
function aRunId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Every prefix the suite actually mints today. */
const LIVE_PREFIXES = ["silver", "gold", "bronze", "fsown", "fscol"];

const HOUR_MS = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 7, 12, 0, 0);

describe("runScopedTeamEmail", () => {
  it("builds `<prefix>-<runId>+clerk_test@<team domain>` (the shape already in the wild)", () => {
    expect(runScopedTeamEmail("silver", "abc123def456")).toBe(
      "silver-abc123def456+clerk_test@agranado.com",
    );
    expect(TEAM_ORG_DOMAIN).toBe("agranado.com");
  });
});

describe("isRunScopedFixtureEmail — the sweep's blast radius", () => {
  it("recognises every address the suite's OWN generator can produce", () => {
    for (const prefix of LIVE_PREFIXES) {
      for (let i = 0; i < 50; i++) {
        const email = runScopedTeamEmail(prefix, aRunId());
        expect(isRunScopedFixtureEmail(email), `${email} must be sweepable`).toBe(true);
      }
    }
  });

  it("recognises an address regardless of casing or surrounding whitespace", () => {
    const email = runScopedTeamEmail("silver", "mzq3k9x2ab7c");
    expect(isRunScopedFixtureEmail(email.toUpperCase())).toBe(true);
    expect(isRunScopedFixtureEmail(`  ${email}  `)).toBe(true);
  });

  it("NEVER matches the hand-provisioned second fixture (no run id in its local part)", () => {
    expect(SECOND_FIXTURE_EMAIL).toBe("silver+clerk_test@agranado.com");
    expect(isRunScopedFixtureEmail(SECOND_FIXTURE_EMAIL)).toBe(false);
    expect(isRunScopedFixtureEmail(SECOND_FIXTURE_EMAIL.toUpperCase())).toBe(false);
  });

  it("NEVER matches a real-looking human address on the SAME domain", () => {
    for (const email of [
      "arthur@agranado.com",
      "arthur.granado@agranado.com",
      "john-smith@agranado.com",
      // A hyphenated human local part that even carries the test-mode marker:
      // the run-id segment is far too short to be one of ours.
      "john-smith+clerk_test@agranado.com",
      "a-b+clerk_test@agranado.com",
      "support+clerk_test@agranado.com",
    ]) {
      expect(isRunScopedFixtureEmail(email), `${email} must NOT be sweepable`).toBe(false);
    }
  });

  it("NEVER matches a run-scoped-LOOKING address on another domain", () => {
    expect(isRunScopedFixtureEmail("silver-mzq3k9x2ab7c+clerk_test@example.com")).toBe(false);
    expect(isRunScopedFixtureEmail("silver-mzq3k9x2ab7c+clerk_test@agranado.com.evil.com")).toBe(
      false,
    );
    expect(isRunScopedFixtureEmail("silver-mzq3k9x2ab7c+clerk_test@notagranado.com")).toBe(false);
  });

  it("NEVER matches without the `+clerk_test` test-mode marker", () => {
    expect(isRunScopedFixtureEmail("silver-mzq3k9x2ab7c@agranado.com")).toBe(false);
    expect(isRunScopedFixtureEmail("silver-mzq3k9x2ab7c+clerk@agranado.com")).toBe(false);
  });

  it("is anchored at both ends — no prefix or suffix smuggling", () => {
    const email = runScopedTeamEmail("silver", "mzq3k9x2ab7c");
    expect(isRunScopedFixtureEmail(`x-${email}`)).toBe(false);
    expect(isRunScopedFixtureEmail(`${email}x`)).toBe(false);
    expect(isRunScopedFixtureEmail(`victim@agranado.com,${email}`)).toBe(false);
    expect(isRunScopedFixtureEmail(`${email},victim@agranado.com`)).toBe(false);
  });

  it("says no to absent / empty / non-string input rather than throwing", () => {
    expect(isRunScopedFixtureEmail(undefined)).toBe(false);
    expect(isRunScopedFixtureEmail(null)).toBe(false);
    expect(isRunScopedFixtureEmail("")).toBe(false);
    expect(isRunScopedFixtureEmail("   ")).toBe(false);
  });

  it("honours the never-sweep list even for an address the pattern WOULD accept", () => {
    const email = runScopedTeamEmail("silver", "mzq3k9x2ab7c");
    expect(isRunScopedFixtureEmail(email)).toBe(true);

    // The caller passes the primary fixture's address (E2E_TEST_USER_EMAIL) in
    // here at runtime; the guard has to win over the pattern.
    expect(isRunScopedFixtureEmail(email, [email])).toBe(false);
    expect(isRunScopedFixtureEmail(email, [email.toUpperCase()])).toBe(false);
    expect(isRunScopedFixtureEmail(email, [`  ${email}  `])).toBe(false);
  });

  it("ships the hand-provisioned fixture in the default never-sweep list", () => {
    expect(NEVER_SWEEP_EMAILS).toContain(SECOND_FIXTURE_EMAIL);
  });
});

describe("RUN_SCOPED_EMAIL_PATTERN_SOURCE", () => {
  // The sweep WORKFLOW (.github/workflows/clerk-sweep.yml) cannot import this
  // module — it is bash + curl + jq. It embeds this exact string as the
  // `RUN_SCOPED_EMAIL_PATTERN` env var instead. Pinning the literal here makes
  // any change to it a visible diff on a failing test, which is the prompt to
  // update the workflow in the same commit.
  it("is byte-identical to the regex embedded in .github/workflows/clerk-sweep.yml", () => {
    expect(RUN_SCOPED_EMAIL_PATTERN_SOURCE).toBe(
      "^[a-z]{3,12}-[0-9a-z]{8,16}\\+clerk_test@agranado\\.com$",
    );
  });
});

describe("isRunScopedDecoyOrgName", () => {
  // `ensureTeamFixtureUser` names the pending-session-heal org
  // `arp-e2e-decoy-<local part of the fixture email>`. Deleting the user does
  // NOT delete an org it created, so leaked decoys accumulate alongside the
  // leaked memberships.
  it("recognises a decoy minted for a run-scoped identity", () => {
    const email = runScopedTeamEmail("gold", "mzq3k9x2ab7c");
    const localPart = email.split("@")[0];
    expect(isRunScopedDecoyOrgName(`arp-e2e-decoy-${localPart}`)).toBe(true);
  });

  it("NEVER matches a decoy minted for the hand-provisioned fixture, or any other org", () => {
    expect(isRunScopedDecoyOrgName("arp-e2e-decoy-silver+clerk_test")).toBe(false);
    expect(isRunScopedDecoyOrgName("arp-e2e-decoy-")).toBe(false);
    expect(isRunScopedDecoyOrgName("Ag47 Org")).toBe(false);
    expect(isRunScopedDecoyOrgName("agranado.com")).toBe(false);
    expect(isRunScopedDecoyOrgName("")).toBe(false);
    expect(isRunScopedDecoyOrgName(undefined)).toBe(false);
  });
});

describe("preRunSweepAgeHours — the serialized-CI age gate (issue #372)", () => {
  // The 24h age gate on the opportunistic sweep exists ONLY to protect a
  // CONCURRENT run's live identities on the shared instance. The `smoke` job's
  // `preview-smoke-shared` concurrency group (cancel-in-progress:false) makes a
  // concurrent smoke impossible — so in that serialized context the gate is
  // pure downside: it is exactly what lets an evicted/killed run's straggler
  // members survive into this run and tip the low cap → 402. There, sweep at
  // age 0 to take every straggler; everywhere else keep the concurrency-safe
  // default so a local `pnpm e2e` can never nuke a colleague's live run.
  it("sweeps at age 0 in the serialized-CI smoke, and at the safe default otherwise", () => {
    expect(preRunSweepAgeHours(true)).toBe(0);
    expect(preRunSweepAgeHours(false)).toBe(SWEEP_MIN_AGE_HOURS);
    expect(SWEEP_MIN_AGE_HOURS).toBe(24);
  });
});

describe("ANCHORED_TEAM_ORG_ID", () => {
  // The canonical `agranado.com` team org (ADR-0074) — the one whose membership
  // cap the leak fills. Its id is ALSO hard-coded as `ORG_ID` in
  // .github/workflows/clerk-sweep.yml (bash + curl cannot import this module),
  // so pinning the literal here makes any change to it a visible failing diff
  // that prompts the paired workflow edit — the same discipline the
  // RUN_SCOPED_EMAIL_PATTERN_SOURCE pin uses.
  it("is byte-identical to ORG_ID in .github/workflows/clerk-sweep.yml", () => {
    expect(ANCHORED_TEAM_ORG_ID).toBe("org_3HK9gdegaQZ1qdkGPgN3RGOTWVO");
  });
});

describe("SMOKE_RUN_SCOPED_FOOTPRINT", () => {
  // The peak number of NEW run-scoped members one full `pnpm e2e` smoke joins
  // into the anchored org: silver/gold/bronze (team-org-upload.feature) plus
  // fsown/fscol (folder-sharing.feature — also @smoke @auth). The preflight
  // must confirm the org has at least this much headroom AFTER the pre-run
  // sweep, or fail fast rather than let a mid-suite provisioning call 402.
  it("is the 5-member peak footprint of a full smoke run", () => {
    expect(SMOKE_RUN_SCOPED_FOOTPRINT).toBe(5);
  });
});

describe("assessAnchoredOrgCap — the fail-fast preflight (issue #372)", () => {
  const footprint = SMOKE_RUN_SCOPED_FOOTPRINT; // 5

  it("passes when the org has strictly more headroom than the run needs", () => {
    const verdict = assessAnchoredOrgCap({ membersCount: 3, maxAllowedMemberships: 20 }, footprint);
    expect(verdict.ok).toBe(true);
    expect(verdict.reason).toBeNull();
  });

  it("passes at the exact boundary — headroom equal to the footprint is enough", () => {
    // 20 - 15 = 5 free, footprint 5 → the run fits exactly.
    expect(
      assessAnchoredOrgCap({ membersCount: 15, maxAllowedMemberships: 20 }, footprint).ok,
    ).toBe(true);
  });

  it("FAILS with an actionable reason when headroom is below the footprint", () => {
    // 20 - 18 = 2 free, footprint 5 → cannot provision the run.
    const verdict = assessAnchoredOrgCap(
      { membersCount: 18, maxAllowedMemberships: 20 },
      footprint,
    );
    expect(verdict.ok).toBe(false);
    // The message must name the numbers an operator needs to act, not 402 opaquely.
    expect(verdict.reason).toContain("18"); // members remaining after the sweep
    expect(verdict.reason).toContain("20"); // the cap
    expect(verdict.reason).toContain("5"); // the footprint
    expect(verdict.reason).toMatch(/cap|headroom/i);
  });

  it("FAILS when the org is already at the cap", () => {
    const verdict = assessAnchoredOrgCap(
      { membersCount: 20, maxAllowedMemberships: 20 },
      footprint,
    );
    expect(verdict.ok).toBe(false);
  });

  it("does NOT block when the cap is unknown/unlimited (non-positive) — fail only on a confirmed shortfall", () => {
    // Clerk's "0 = unlimited" for max_allowed_memberships is unconfirmed in the
    // docs, so a non-positive cap is treated as unknown: never fail-fast on it,
    // because a false setup failure is worse than deferring to the real 402.
    expect(
      assessAnchoredOrgCap({ membersCount: 999, maxAllowedMemberships: 0 }, footprint).ok,
    ).toBe(true);
    expect(
      assessAnchoredOrgCap({ membersCount: 999, maxAllowedMemberships: -1 }, footprint).ok,
    ).toBe(true);
  });

  it("does NOT block when a count is not a finite number — treat as undeterminable", () => {
    expect(
      assessAnchoredOrgCap({ membersCount: Number.NaN, maxAllowedMemberships: 20 }, footprint).ok,
    ).toBe(true);
    expect(
      assessAnchoredOrgCap({ membersCount: 5, maxAllowedMemberships: Number.NaN }, footprint).ok,
    ).toBe(true);
  });
});

describe("selectSweepableUsers", () => {
  const runScoped = runScopedTeamEmail("silver", "mzq3k9x2ab7c");
  const alsoRunScoped = runScopedTeamEmail("bronze", "mzq3k9x2ab7d");

  const users = [
    { id: "user_live", email: runScoped, createdAtMs: NOW - 1 * HOUR_MS },
    { id: "user_old", email: alsoRunScoped, createdAtMs: NOW - 48 * HOUR_MS },
    { id: "user_human", email: "arthur@agranado.com", createdAtMs: NOW - 900 * HOUR_MS },
    { id: "user_fixture", email: SECOND_FIXTURE_EMAIL, createdAtMs: NOW - 900 * HOUR_MS },
  ];

  it("with olderThanHours 0, takes every run-scoped identity and nothing else", () => {
    const selected = selectSweepableUsers(users, { nowMs: NOW, olderThanHours: 0 });

    expect(selected.map((u) => u.id)).toEqual(["user_live", "user_old"]);
  });

  it("age-gates so a CONCURRENT run's live identities are never deleted", () => {
    const selected = selectSweepableUsers(users, {
      nowMs: NOW,
      olderThanHours: SWEEP_MIN_AGE_HOURS,
    });

    expect(SWEEP_MIN_AGE_HOURS).toBe(24);
    expect(selected.map((u) => u.id)).toEqual(["user_old"]);
  });

  it("treats the age boundary as inclusive", () => {
    const exactly = [{ id: "u", email: runScoped, createdAtMs: NOW - 24 * HOUR_MS }];

    expect(selectSweepableUsers(exactly, { nowMs: NOW, olderThanHours: 24 })).toHaveLength(1);
  });

  it("keeps an undated identity when age is not being gated, and skips it when it is", () => {
    const undated = [{ id: "u", email: runScoped, createdAtMs: Number.NaN }];

    expect(selectSweepableUsers(undated, { nowMs: NOW, olderThanHours: 0 })).toHaveLength(1);
    expect(selectSweepableUsers(undated, { nowMs: NOW, olderThanHours: 24 })).toHaveLength(0);
  });

  it("accepts an extra never-sweep list from the caller", () => {
    const selected = selectSweepableUsers(users, {
      nowMs: NOW,
      olderThanHours: 0,
      neverSweep: [runScoped],
    });

    expect(selected.map((u) => u.id)).toEqual(["user_old"]);
  });

  it("returns nothing for an empty instance", () => {
    expect(selectSweepableUsers([], { nowMs: NOW, olderThanHours: 0 })).toEqual([]);
  });
});

describe("the serialized age-0 pre-run sweep NEVER takes a protected identity (issue #372)", () => {
  // The aggressive age-0 sweep is the whole fix, and it is also the whole
  // danger: it takes EVERY run-scoped identity regardless of age. These pin the
  // NEVER-SWEEP protections under that exact path — the hand-provisioned
  // SECOND_FIXTURE, the primary fixture, a real human on the domain, and the
  // canonical anchored org must all survive it.
  const age0 = { nowMs: NOW, olderThanHours: preRunSweepAgeHours(true) };
  const oldRunScoped = runScopedTeamEmail("gold", "mzq3k9x2ab7d");

  it("takes stragglers of ANY age but never the standing/human users", () => {
    const users = [
      {
        id: "straggler_fresh",
        email: runScopedTeamEmail("silver", "mzq3k9x2ab7c"),
        createdAtMs: NOW - 1,
      },
      { id: "straggler_hours", email: oldRunScoped, createdAtMs: NOW - 3 * HOUR_MS },
      { id: "second_fixture", email: SECOND_FIXTURE_EMAIL, createdAtMs: NOW - 1 },
      { id: "human", email: "arthur@agranado.com", createdAtMs: NOW - 1 },
    ];
    const primary = "primary+clerk_test@agranado.com"; // stands in for E2E_TEST_USER_EMAIL

    const selected = selectSweepableUsers(users, { ...age0, neverSweep: [primary] });

    expect(preRunSweepAgeHours(true)).toBe(0);
    expect(selected.map((u) => u.id)).toEqual(["straggler_fresh", "straggler_hours"]);
  });

  it("takes run-scoped decoys of ANY age but never the canonical anchored org", () => {
    const localPart = runScopedTeamEmail("silver", "mzq3k9x2ab7c").split("@")[0];
    const orgs = [
      { id: "decoy_fresh", name: `arp-e2e-decoy-${localPart}`, createdAtMs: NOW - 1 },
      { id: "org_canonical", name: "agranado.com", createdAtMs: NOW - 1 },
    ];

    const selected = selectSweepableOrganizations(orgs, age0);

    expect(selected.map((o) => o.id)).toEqual(["decoy_fresh"]);
  });
});

describe("selectSweepableOrganizations", () => {
  const localPart = runScopedTeamEmail("silver", "mzq3k9x2ab7c").split("@")[0];

  const orgs = [
    { id: "org_decoy_old", name: `arp-e2e-decoy-${localPart}`, createdAtMs: NOW - 48 * HOUR_MS },
    { id: "org_decoy_new", name: `arp-e2e-decoy-${localPart}`, createdAtMs: NOW - 1 * HOUR_MS },
    // The anchored canonical team org the whole scenario exists to prove.
    { id: "org_canonical", name: "agranado.com", createdAtMs: NOW - 900 * HOUR_MS },
    {
      id: "org_hand_decoy",
      name: "arp-e2e-decoy-silver+clerk_test",
      createdAtMs: NOW - 900 * HOUR_MS,
    },
  ];

  it("takes only run-scoped decoys, never the canonical org", () => {
    const selected = selectSweepableOrganizations(orgs, { nowMs: NOW, olderThanHours: 0 });

    expect(selected.map((o) => o.id)).toEqual(["org_decoy_old", "org_decoy_new"]);
  });

  it("age-gates the same way the user sweep does", () => {
    const selected = selectSweepableOrganizations(orgs, { nowMs: NOW, olderThanHours: 24 });

    expect(selected.map((o) => o.id)).toEqual(["org_decoy_old"]);
  });
});
