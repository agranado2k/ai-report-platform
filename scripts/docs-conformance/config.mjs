// Declarative configuration for the docs-conformance harness.
//
// This file is intentionally the single place where the "rules" live, so the
// rules are themselves reviewable in a PR. Validators read from here; they
// hold no policy of their own. See docs/adr/0041 and PRD issue #13.

/** ADR (MADR) conformance rules. */
export const adr = {
  // Status vocabulary allowed in an ADR's `**Status**` field (INDEX.md may
  // append a date, e.g. "Accepted (2026-06-04)" — matched by startsWith).
  allowedStatuses: ["Proposed", "Accepted", "Rejected", "Deprecated", "Superseded by"],
  // Section headings every ADR must carry (case-insensitive substring match).
  // Calibrated against ADR-0035..0040 so existing records pass.
  requiredSections: [
    "Context and problem statement",
    "Decision drivers",
    "Decision outcome",
    "Considered options",
    "More information",
  ],
};

/** Ubiquitous-language rules (ADR-0036). */
export const glossary = {
  // Files excluded from the banned-alias scan. The diary is a chronological
  // log that legitimately quotes superseded terms when recording renames.
  scanExclude: ["docs/diary.md"],
  // Banned aliases → canonical term. `re` is matched per line; lines that
  // document the ban itself (containing "_Avoid_" / "Avoid:") are skipped.
  bannedAliases: [
    {
      term: "Version",
      canonical: "ReportVersion",
      // Standalone capitalised "Version" — not part of "ReportVersion",
      // "version_no", a hyphenated slug, etc.
      re: /(?<![\w-])Version(?![\w-])/,
      hint: 'A snapshot of a report\'s content is a "ReportVersion" (glossary).',
    },
  ],
};

/** Canonical domain events (docs/events.md is the registry). */
export const events = [
  "ReportVersionUploaded",
  "ReportPublished",
  "AclChanged",
  // CollaboratorGranted retired (ADR-0060, PR #150) — write grants shipped
  // deliberately without a replacement event; the events.md row is a tombstone.
  "UserCreated",
  "ApiKeyUsed",
  "ApiKeyAnomalyDetected",
  "ReportVersionScanned",
  "AbuseReported",
  "ReportTakenDown",
  "CspViolationReported",
  "CommentAdded",
  "CommentResolved",
  "CommentEdited",
];

/** Gherkin tag vocabulary. Every .feature must carry exactly one phase tag.
 *  `extra` also carries the EXECUTION tags the Playwright harness greps on
 *  (playwright.config.ts) — `@smoke` selects the running set, `@auth` /
 *  `@browser` gate on which Clerk credentials are configured, `@run-scoped`
 *  binds a scenario to the fixture-cleanup hook. They were previously legal
 *  only in tests/e2e/smoke/ (which this validator doesn't scan); a catalogued
 *  use-case feature that actually RUNS needs them too.
 *
 *  `@allow-skip` opts a scenario OUT of the CI skip guard
 *  (tests/e2e/support/skip-guard.ts), which otherwise fails the job when a
 *  scenario skips in CI. It lives in this reviewed vocabulary rather than being
 *  a free-floating string precisely because silencing a coverage alarm should
 *  be a decision someone signs off on. Nothing uses it today. */
export const featureTags = {
  phases: ["@phase-1", "@phase-1.5", "@phase-2", "@phase-2.5", "@phase-3", "@phase-4"],
  extra: ["@wip", "@security", "@smoke", "@auth", "@browser", "@run-scoped", "@allow-skip"],
};

/**
 * The use-case catalog. `feature-presence` enforces a bijection between these
 * slugs and `tests/e2e/features/<slug>.feature`; `feature-executes` additionally
 * requires every `status: 'full'` entry to be opted into `playwright.config.ts`'s
 * `features` array and to have step definitions beside it.
 *
 * WHAT THE TWO STATUSES MEAN NOW (revised 2026-08-06):
 *
 *   - `'full'`  — this use-case EXECUTES in CI. It is listed in
 *                 playwright.config.ts, it has a `<slug>.steps.ts`, and
 *                 `feature-executes` fails the build if either stops being
 *                 true. There is no third state where a feature "has worked
 *                 scenarios" but does not run.
 *   - `'wip'`   — a KNOWN COVERAGE GAP: the behaviour is real, user-visible,
 *                 and covered by NOTHING in any tier — usually because it is
 *                 not implemented yet. Each one carries an issue-shaped note in
 *                 tests/e2e/README.md saying what is missing and why it cannot
 *                 simply be wired.
 *
 * THE CORPUS WAS 33 FILES AND 1 OF THEM RAN. That is worse than an empty
 * catalog: a `.feature` file describing a behaviour is what stops the next
 * person writing the test for it, so a catalog claiming coverage it does not
 * have actively suppresses coverage. On 2026-08-06 all 32 non-running files
 * were resolved — 23 deleted because the behaviour is genuinely verified
 * elsewhere (tombstones below name where), 1 wired, 8 kept as declared gaps.
 * The full evidence table is in tests/e2e/README.md.
 *
 * ── TOMBSTONES: deleted because the behaviour is covered elsewhere ──────────
 * Each line is `slug → where the behaviour is actually verified`. If you are
 * about to re-add one of these as a `.feature` file, read the named tests
 * first: the coverage exists, it is simply not Gherkin.
 *
 *   audit-log-every-action     → audit-logger.contract.ts (two-runner, in-mem +
 *                                pglite) + per-action rows in set-acl.test.ts,
 *                                grant-write.test.ts, move-report.test.ts;
 *                                redaction in create-api-key.test.ts
 *   comment-on-a-report        → reply-to-comment / list-comments /
 *                                resolve-comment .test.ts, comment-response.test.ts,
 *                                comment-repository.contract.ts (two-runner)
 *   cross-org-collaboration    → superseded by ADR-0060; the successor design is
 *                                covered by load-owned.test.ts (cross-org
 *                                grantee) + write-grant-store.contract.ts
 *   enforce-api-key-scopes     → upload-report.test.ts (InsufficientScope),
 *                                upload-response.test.ts (403 vs 401),
 *                                resolve-actor.server.test.ts; smoke upload-api
 *   enforce-plan-limits        → upload-report.test.ts (402), upload-response.test.ts
 *                                (402 vs 429), http.server.test.ts.
 *                                NB the prod adapter is AllowAllPlanLimiter —
 *                                the MAPPING is covered, a real quota is not.
 *   idempotent-write-api       → idempotent-write.test.ts (all five scenarios),
 *                                idempotency-store.contract.ts (two-runner),
 *                                handle.server.test.ts end-to-end through the seam
 *   list-report-versions       → list-report-versions.test.ts, list-response.test.ts,
 *                                report-repository.contract.ts listVersions
 *   organize-reports-in-folders→ move-report.test.ts, folder-repository.contract.ts;
 *                                smoke team-org-upload creates + moves for real
 *   problem-json-error-model   → upload-response.test.ts CASES (every kind, each
 *                                asserting problem+json shape), problem.test.ts
 *   re-upload-keeps-url-stable → upload-report.test.ts (update_slug, non-owner 403),
 *                                process-scan-result.test.ts, view-report.test.ts
 *   report-flagged-unavailable → gate.server.test.ts (451, reason-opaque),
 *                                view-report.test.ts at any ordinal
 *   report-taken-down          → gate.server.test.ts (410 precedes ACL),
 *                                report-repository.contract.ts softDelete
 *   report-write-grants        → grant-write / revoke-write / load-owned / get-acl
 *                                .test.ts, write-grant-store.contract.ts (two-runner)
 *   sharing-modes              → resolve-access.test.ts (every Examples row),
 *                                gate.server.test.ts, unlock-route.test.ts
 *   sign-up-and-switch-orgs    → provision-identity.test.ts, search-reports.test.ts,
 *                                report-repository.contract.ts; smoke team-org-upload
 *   trusted-types-dashboard    → app-headers.test.ts pins the TT policy header
 *   upload-report-via-api      → smoke auth-upload.feature (201 + slug + canonical
 *                                view_url against real infra) + upload-report.test.ts
 *   upload-report-via-mcp      → apps/mcp client.test.ts + tools.test.ts (the tool
 *                                is a thin wrapper over the same HTTP API)
 *   view-published-report      → view-report.test.ts, gate.server.test.ts,
 *                                view-headers.test.ts, slug.test.ts
 *   view-report-while-scanning → view-report.test.ts, gate.server.test.ts
 *                                interstitial, drain-scans.test.ts; and the smoke
 *                                editor-auth scenario drives the real drain
 *   view-version-by-ordinal    → view-report.test.ts ?v=N (11 tests),
 *                                version-query.test.ts, gate.server.test.ts
 *   viewer-origin-isolation    → cors.test.ts, view-headers.test.ts (opaque origin,
 *                                COOP/CORP/OAC) + view-headers.live.test.ts
 *   viewer-security-headers    → view-headers.test.ts AND the deployed gate
 *                                view-headers.live.test.ts (security-headers.yml)
 *
 * Slices of the above that are NOT covered are listed as explicit gaps in
 * tests/e2e/README.md rather than being papered over by keeping the file.
 *
 * Earlier deletions, kept for provenance: share-folders.feature (ADR-0076 UI PR
 * — its narrative is carried by folder-sharing.feature, which runs);
 * review-version-history-and-diff / edit-report-in-dashboard /
 * view-edit-deep-link (ADR-0063 Phase 5-C — the dashboard editor is deleted).
 */
export const features = {
  // ── EXECUTES IN CI ───────────────────────────────────────────────────
  "block-service-worker": {
    title: "Block service-worker registration at the edge (ADR-0014)",
    phase: "@phase-1",
    status: "full",
  },
  "folder-sharing": {
    title: "Manage folder visibility and sharing from the dashboard (ADR-0076)",
    phase: "@phase-2",
    status: "full",
  },
  // ── KNOWN COVERAGE GAPS ──────────────────────────────────────────────
  // Real, user-visible behaviour with NO coverage in any tier. Each has an
  // issue-shaped note in tests/e2e/README.md. Most are not implemented at all,
  // which is why they cannot simply be wired.
  "upload-guardrails": {
    title: "Upload pre-check guardrails (zip-slip, decompression bomb, caps)",
    phase: "@phase-1",
    status: "wip",
  },
  "reject-svg-upload": { title: "Reject SVG uploads", phase: "@phase-1", status: "wip" },
  "upload-report-via-web": {
    title: "Upload a report from the web UI",
    phase: "@phase-1",
    status: "wip",
  },
  "malware-scan-eicar": { title: "Malware scan blocks EICAR", phase: "@phase-1.5", status: "wip" },
  "submit-abuse-report": { title: "Submit an abuse report", phase: "@phase-1.5", status: "wip" },
  "enforce-rate-limits": { title: "Enforce rate limits", phase: "@phase-1.5", status: "wip" },
  "detect-api-key-anomaly": {
    title: "Detect API-key usage anomalies",
    phase: "@phase-4",
    status: "wip",
  },
  "enforce-mfa": { title: "Enforce MFA for admins", phase: "@phase-4", status: "wip" },
};

/**
 * Agent-manual rules (plan Phase 1.2, ADR-0082's layered constitution).
 *
 * The manual is a layered set of files, all of them standing instructions the
 * agent obeys: the root `AGENTS.md` (with `CLAUDE.md` / `GEMINI.md` shims beside
 * it), the on-demand articles under `constitution/`, and the nested package
 * manuals below. Every layer gets the same two existence checks — slash commands
 * must resolve to `.claude/skills/<name>/SKILL.md`, referenced repo paths must
 * exist — plus the shim-integrity rule on the shims, and, for the shared
 * articles only, the portability guard further down.
 */
export const claudeMdRefs = {
  // rootManual left unset → defaults to AGENTS.md (v0.10.0). The root manual is
  // AGENTS.md and CLAUDE.md / GEMINI.md are shims that import it.
  //
  // The on-demand articles live at the repo root under constitution/ (moved out
  // of .claude/constitution/ when this repo adopted the v0.10.0 layout).
  constitutionDir: "constitution",

  // The tool entry points beside the root manual. Each must be a bare
  // `@AGENTS.md` shim (plus at most one comment line) — the `shim-invalid` rule
  // stops a second manual quietly growing in one tool's file. The nested pairs
  // shim the package manuals under apps/mcp and packages/domain.
  shims: [
    "CLAUDE.md",
    "GEMINI.md",
    "apps/mcp/CLAUDE.md",
    "apps/mcp/GEMINI.md",
    "packages/domain/CLAUDE.md",
    "packages/domain/GEMINI.md",
  ],

  // Commands that are real but are not repo skills. Each carries its reason
  // here so the exemption is itself reviewable.
  ignoreCommands: [
    "/loop", // Claude Code global skill (interval runner), not a repo skill
    "/security-review", // Claude Code built-in
    "/install-github-app", // Claude Code built-in (one-time setup, quoted in ADR-030 context)
    "/merge", // historical reference — the obsolete bot-merge flow, quoted as history
  ],

  /**
   * Repo-anchored path roots — the trees the manual layer points into, and the
   * reviewed surface of the repo. A backticked token whose FIRST segment is one
   * of these is resolved repo-relative, from whichever manual names it.
   *
   * This list is also half of the nested-manual resolution rule (see
   * `nestedManuals`): anchored first segment → repo-relative; anything else in a
   * nested manual → relative to that manual's own directory. Roots deliberately
   * absent (`node_modules/`, `worktree/`, generated output) are not part of the
   * reviewed surface, so references into them stay unchecked.
   */
  pathRoots: [
    "scripts",
    ".husky",
    ".github",
    "docs",
    "apps",
    "packages",
    "infra",
    "tests",
    ".claude/hooks",
    ".claude/skills",
    "constitution",
  ],

  /**
   * Nested package manuals (ADR-0082 layer 4). Claude Code loads one of these
   * only when an agent works in that tree, which makes them exactly as binding
   * as the root while it is loaded — and exactly as poisonous when stale.
   *
   * THE RESOLUTION RULE, decided here because it is policy: inside a nested
   * manual, a path token whose first segment is in `pathRoots` above means the
   * repo-root path (`tests/evals/` in `apps/mcp/AGENTS.md` is the repo's eval
   * suite, not a package-local one); every other path token is resolved against
   * `dir`. To keep prose out of the check, a package-relative token must contain
   * a `/` AND either end in `/` (a directory) or have a dotted final segment (a
   * filename) — so `src/tools.ts` and `packaging/` are checked while
   * `server.test.ts`, `*.test.ts` and `OVERCLAIM_PATTERNS` are not.
   *
   * Repo-level manuals (root + articles) never resolve package-relative: they
   * have no package to be relative to.
   *
   * Nested manuals are NOT subject to the `article-unreferenced` reachability
   * rule — unlike an article, nothing has to point at them to make them load.
   */
  nestedManuals: [
    // Reason: ADR-0072's three prompt layers are shipped behavior; this manual
    // names the files that carry them (`src/instructions.ts`, `skill/…`).
    { dir: "apps/mcp" },
    // Reason: the purity rules restate ADR-024/ADR-0036 for agents that never
    // load the article, and they cite the glossary and adapter tree by path.
    { dir: "packages/domain" },
  ],

  /**
   * Portability guard for the shared (framework) article.
   *
   * ADR-0082 makes `cp shared-invariants.md <other repo>` the *test* of the
   * article's portability, and the file's own header states the constraint: it
   * "names no product, no package, no command, and no vendor". That claim is
   * only worth anything if something checks it — otherwise the first local
   * detail to leak in silently converts the framework artifact back into a
   * project document, and nobody notices until the copy fails somewhere else.
   *
   * The deny-list below is grounded in that sentence: one entry per category of
   * local vocabulary, each with the reason it cannot appear. `scope` says where
   * an entry is looked for:
   *   - `prose`  — the whole file, fences included. Names leak in sentences.
   *   - `spans`  — markdown code spans only. Paths and commands are written in
   *                code spans by convention, and scanning prose for them would
   *                misread ordinary "either/or" phrasing as a path.
   */
  portability: {
    files: ["constitution/shared-invariants.md", "constitution/shared-code-craft.md"],
    deny: [
      {
        id: "product-name",
        scope: "prose",
        re: /\bcentaur[\s-]?spec\b/i,
        reason:
          "The product this framework was extracted from. A product name breaks the verbatim copy on line one — move the sentence to a local-* article and state the rule abstractly here.",
      },
      {
        id: "product-hostname",
        scope: "prose",
        // No `sh`: every shell script in the tree ends in it, so the TLD
        // alternation read `worktree-cleanup.sh` as a hostname and reported a
        // real leak under the wrong id, with a hint about deployment addresses.
        // Script paths are already covered by `repo-path` / `tool-invocation`.
        re: /\b(?:[a-z0-9-]+\.)+(?:com|dev|io|app)\b/i,
        reason:
          "A hostname is deployment-specific, and the framework has no deployment. Describe the role ('the published viewer origin'), not the address.",
      },
      {
        id: "vendor-name",
        scope: "prose",
        re: /\b(?:Anthropic|Claude|Gemini|OpenAI|GitHub|GitLab|Vercel|Cloudflare|Neon|Clerk|Drizzle|Playwright|Terraform|Turborepo|Stryker|Promptfoo|Biome|Vitest|Husky|Postgres(?:QL)?|Cucumber)\b/i,
        reason:
          "Naming a vendor or tool binds the rule to this stack. State what the mechanism must achieve; the tool that achieves it belongs in local-engineering / local-workflow.",
      },
      {
        id: "tool-invocation",
        scope: "prose",
        re: /\b(?:pnpm|npm|npx|yarn|git|gh|terraform|docker)\s+[a-z][\w:-]*/i,
        reason:
          "A concrete command cannot survive a copy into a repo with a different toolchain. Name the obligation ('the docs gate must pass before push'), not the invocation.",
      },
      {
        id: "slash-command",
        scope: "spans",
        re: /^[([{"']?\/[a-z][a-z0-9-]*/,
        reason:
          "A slash command names a skill that exists in THIS repo's .claude/skills. The portable rule is the practice, not the command that runs it.",
      },
      {
        id: "repo-path",
        scope: "spans",
        re: /^[\w.@-]+(?:\/[\w.@*-]+)+\/?$/,
        reason:
          "A repo path bakes in this project's layout. Sibling article filenames (no directory separator) are part of the framework and stay legal; anything with a `/` does not.",
      },
    ],
  },
};

/** OpenAPI structural assertions (lint-lite; full Spectral lint is deferred). */
export const openapi = {
  mustContain: [
    "openapi: 3.1",
    "/api/v1/reports",
    "Idempotency-Key",
    "application/problem+json",
    // ADR-0040 status mapping + the success code (quoted YAML response keys).
    "'201'",
    "'401'",
    "'402'",
    "'403'",
    "'404'",
    "'409'",
    "'413'",
    "'415'",
    "'422'",
    "'429'",
    "'500'",
    // Stable machine-readable `code` registry (ADR-0040).
    "unauthenticated",
    "forbidden",
    "not_found",
    "unsupported_media_type",
    "payload_too_large",
    "validation_error",
    "idempotency_key_reuse",
    "idempotency_in_flight",
    "plan_limit_exceeded",
    "rate_limited",
    "internal_error",
  ],
  hints: {
    "application/problem+json": "Error responses use RFC 9457 problem+json (ADR-0040).",
    "Idempotency-Key": "Document the Idempotency-Key request header (ADR-0039).",
    "'402'": "PlanLimitExceeded maps to 402, distinct from 429 (ADR-0040).",
  },
};

export default { adr, glossary, events, featureTags, features, claudeMdRefs, openapi };
