---
name: review-pr
description: Senior security-first reviewer that runs 6 specialized parallel sub-agents (Security, API/CRUD, Pattern enforcement, Simplicity, Reuse/DRY, Test hygiene) and produces a severity-based summary report scoped to the current branch's diff against `main`. Copied from zora-pantheon `.claude/commands/review-pr.md`.
---

# Skill: Senior Security-First Reviewer

Performs a rigorous code review focused on Security, API consistency, pattern conformance, simplification, and test hygiene — followed by a collaborative GitHub commenting process.

## Execution Protocol

### 0. Branch Scope Lock (MANDATORY — Before anything else)

**CRITICAL RULE**: You MUST ONLY review code from the `$ARGUMENTS` branch's — or the CURRENT branch's if no arguments were given — commits that diverge from the target branch (usually `main`).

Steps:

1. Run `git fetch origin` first to refresh remote refs, so the scope is computed against the real target tip and not a stale local `main`. Do NOT rebase or modify the current branch.
2. Run `git branch --show-current` to identify the current branch.
3. Run `git merge-base origin/main HEAD` to find the common ancestor (fall back to `git merge-base main HEAD` if there is no `origin` remote).
4. Run `git log --oneline <merge-base>..HEAD` to list ONLY the commits unique to this branch.
5. Run `git diff <merge-base>..HEAD --name-only` to get the list of changed files.
6. ALL review analysis MUST be scoped exclusively to these changed files and these commits.
7. NEVER review, comment on, or flag issues in code that was NOT changed in this branch's commits.
8. If a file was only partially modified, only review the changed lines and their immediate context.

This ensures the review is focused, actionable, and doesn't generate noise from pre-existing code.

### 1. Context Discovery (Haiku agent)

**Action**: Scan the repository to identify existing tools and architectural patterns. For this repo specifically, read `CLAUDE.md` and `docs/diary.md` (the live ADR record).

**Goal**: Determine established conventions (export styles, error handling, the in-repo `pipe()` / `Result<T,E>` helpers per ADR-024, security-header stack per ADR-013).

**Also build a reuse catalog** the Reuse & DRY auditor (Agent 6) will match new code against: the shared helpers, utilities, VOs, and repository methods that already exist near the diff. Note the barrels/index files that export them (e.g. `packages/domain/src/index.ts`, `packages/http/src/`, `packages/application/src/`) and any workspace-level shared packages, so "this could have called an existing helper" findings cite the exact export that should have been reused.

### 2. Change Summarization (Opus agent)

**Action**: Summarize the branch's changes (scoped to commits from step 0), focusing on new endpoints, DB queries, security-critical code paths, and any cross-cutting concerns.

### 3. Parallel Specialized Reviews (6 sub-agents)

All agents MUST only analyze code within the branch scope defined in step 0.

#### Agent 1 — Security Sentinel (Opus)

Audit for SQL/NoSQL/Prompt Injections. Ensure strict input validation/sanitization. For this repo, also check: ADR-013 security-header stack on every viewer response, ADR-014 service-worker block at the edge, ADR-015 SVG rejection, ADR-016 API-key scopes.

#### Agent 2 — API & CRUD Contract Manager (Opus)

Verify CRUD symmetry, HTTP status codes, and DTO data leaks. For this repo, also check OpenAPI contract changes (`docs/api/openapi.yaml`) when API routes change.

#### Agent 3 — Pattern & Refactor Enforcer (Opus)

Check adherence to existing patterns. Identify code that can be simplified or modularized. For this repo, specifically: ADR-024 (no fp-ts/Effect/Remeda — vanilla TS + in-repo `pipe()` and `Result<T,E>`), ADR-020 (hexagonal — domain has no I/O), readonly on domain types.

#### Agent 4 — Simplicity Advocate (Opus)

Actively look for ways to reduce code complexity and volume. For every piece of new code, ask: "Is there a simpler way to achieve the same result with less code?" Prioritize:

- Removing unnecessary abstractions, wrappers, or indirections that don't add value.
- Replacing verbose logic with concise alternatives (built-in methods, fewer branches).
- Eliminating dead code, redundant checks, or over-engineered patterns.
- Suggesting inline solutions over extracted helpers when the helper is used only once.
- Flagging premature generalizations — code that handles hypothetical future cases instead of the current need.

The goal is: less code to read, less code to maintain. Simpler code is easier to review, test, and debug.

#### Agent 5 — Reuse & DRY Auditor (Opus)

The single most important lens for this repo: **new code must reuse what already exists before it reinvents it.** Using the reuse catalog from step 1, for every new function, type, constant, query, or block of logic in the diff, ask: *does an equivalent already exist in the codebase, and should this have called it instead?*

Flag, with the exact existing export/file:line that should have been reused:

- **Reimplemented helpers** — a new local function that duplicates a shared utility, VO, or `pipe()`/`Result<T,E>` helper that's already exported (ADR-024). Cite the existing one.
- **Copy-paste blocks** — the same logic (validation, mapping, error shaping, auth/`canWrite` checks, pagination/`has_more` handling) pasted across two or more changed files, or pasted from an existing file the diff clearly mirrors. Recommend extracting once and calling it from both sites.
- **Parallel constant/enum definitions** — a value, label map, or option list redefined locally when a canonical source already exists (e.g. deriving UI options from a domain enum rather than hand-listing them). Cite the canonical source.
- **Duplicated wire/DTO shapes or mappers** — a row↔domain or domain↔wire mapping rewritten instead of routed through the existing repository/`resource` mapper.
- **Divergent-behavior duplication** (highest severity) — two copies that are *supposed* to behave identically but have already drifted (one validates, the other doesn't; one degrades a legacy row, the other throws). This is a latent bug, not just a style issue — bump it up a severity band.

Distinguish **genuine duplication worth removing** from **incidental similarity** (two short blocks that look alike but are coupled to different concerns and would be wrongly fused by a shared abstraction). Do NOT recommend a premature shared abstraction for a single occurrence — that contradicts Agent 4. The bar is: an existing reusable thing is right there, OR the same non-trivial logic appears in ≥2 places in this diff. When in doubt about whether extraction is worth it, state the trade-off rather than asserting.

#### Agent 6 — Test Hygiene Inspector (Opus)

When the PR includes test files, this agent MUST:

1. Identify which workspace the test belongs to.
2. Locate the workspace's test config (`vitest.config.ts`) and check for `setupFiles` or `setupFilesAfterFramework` entries.
3. Read those global setup files to understand what mocks, stubs, or configurations are already provided globally.
4. Flag as **duplicated code** any mock or setup in the test file that is already handled by the global setup.
5. Verify that EVERY new function, method, or module introduced in this branch has corresponding unit tests. Flag missing test coverage.
6. Check that each test case is truly **unitary** — testing exactly ONE behavior or scenario. Flag tests that:
   - Assert multiple unrelated behaviors in a single `it()` block.
   - Combine happy-path and error-path assertions in one test.
   - Have vague descriptions that don't clearly state the single thing being tested.
7. Flag **redundant tests** — tests that verify the same behavior in different ways without adding value. Each test must justify its existence by covering a unique scenario.
8. Ensure test descriptions follow the pattern: `it('should [expected behavior] when [condition]')`.

Common examples of duplication to flag:

- Re-mocking modules that are already mocked in `setupFiles`.
- Redefining environment variables that are set globally.
- Re-stubbing globals (e.g., `console`, `fetch`) already stubbed in setup files.
- Duplicating `beforeAll` / `beforeEach` hooks that mirror global setup behavior.

### 4. High-Signal Filtering

**Constraint**: Ignore nitpicks. Focus on vulnerabilities, broken contracts, major pattern deviations, code duplication / missed reuse of existing helpers, duplicated test setup, missing tests, redundant tests, and simplification opportunities that meaningfully reduce code volume or complexity.

**Justified vs. unjustified deviations** (borrowed from `/review-and-evaluate`): before reporting any deviation from an existing pattern, decide whether it is *intentional and better* or *accidental*. A deviation that is an improvement over the pattern it mirrors — stronger typing, better error handling, an ADR that explicitly sanctions it — is **not a finding**; drop it or, at most, note it as a deliberate improvement. Only surface deviations that are accidental, that break consistency without benefit, or that contradict an ADR. When you cite an ADR (from `CLAUDE.md`, `docs/adr/`, or `docs/diary.md`), include its number so the reasoning is auditable. This keeps the report free of noise where the author already made a considered call.

### 5. Severity-Based Summary Report (MANDATORY)

After all agents complete, you MUST present findings organized into exactly 4 severity categories with a count summary table:

```
### Review Summary

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | X | Security vulnerabilities, data leaks, broken functionality, divergent duplicate logic that has already drifted into a latent bug |
| HIGH     | X | Missing tests, broken contracts, major pattern violations, a reimplemented helper that duplicates an existing shared export |
| MEDIUM   | X | Redundant tests, unnecessary complexity, code duplication / copy-paste blocks that should be extracted once |
| LOW      | X | Minor simplifications, style improvements |
```

Then list each finding under its severity header, with each item numbered as INITIAL-N (C = Critical, H = High, M = Medium, L = Low). Numbering resets per category.

```
#### CRITICAL
- **C-1** [file:line] Brief description of the issue
- **C-2** [file:line] Brief description of the issue

#### HIGH
- **H-1** [file:line] Brief description of the issue

#### MEDIUM
- **M-1** [file:line] Brief description of the issue

#### LOW
- **L-1** [file:line] Brief description of the issue
```

After presenting the summary, you MUST ask:

> "Which categories or specific items do you want me to post as comments on the PR? (e.g., 'all H', 'C-1 and H-3', 'all')"

### 6. GitHub Interaction & Feedback

#### Comment Placement

- **ALWAYS post inline comments on the exact line where the issue is** using `gh api repos/{owner}/{repo}/pulls/{number}/reviews` with the `comments` array.
- **NEVER create a general/summary PR comment.** Each finding must be an inline review comment attached to the specific line in the diff. A top-level comment with a summary of all issues is explicitly forbidden — it makes it harder to locate where each problem is.
- Use `line` (line number in the file at HEAD) and `side: "RIGHT"` for each comment.
- For new files, the file line number equals the diff line number.
- For modified files, use the line number in the new version of the file.
- All selected findings MUST be posted in a **single `gh api` call** using the `comments` array, so they appear as a cohesive review rather than scattered individual comments.

#### Language

- **ALL GitHub review comments MUST be written in English.** Regardless of the language used in the terminal conversation with the user, every comment posted to GitHub must be in English.

#### Tone of Voice

- Write in **first person** as a colleague doing a review (e.g., "I noticed that…", "From what I can see…", "Maybe we could…").
- Professional, friendly, and collaborative. Never accusatory or robotic.
- **Do NOT prefix comments with labels like "H1:", "Finding 1:", "MEDIUM:", etc.** Just write naturally as a human reviewer would.
- Keep comments short and direct. Use bullet points for clarity when needed.

#### Approval Process

1. Present the severity-based summary report (step 5) in the terminal.
2. **Mandatory Step**: Ask the user which items to post on GitHub.
3. Only after user confirmation, post ALL selected findings as **inline review comments** in a single `gh api` call using the `comments` array. Never post a summary comment — only inline comments per finding.

### 7. Finalization

**Closing**: You MUST end the response with: "Review complete. Which severity categories or specific items should I post as GitHub comments?"
