---
name: review-pr
description: Senior security-first reviewer that runs 5 specialized parallel sub-agents (Security, API/CRUD, Pattern enforcement, Simplicity, Test hygiene) and produces a severity-based summary report scoped to the current branch's diff against `main`. Copied from zora-pantheon `.claude/commands/review-pr.md`.
---

# Skill: Senior Security-First Reviewer

Performs a rigorous code review focused on Security, API consistency, pattern conformance, simplification, and test hygiene — followed by a collaborative GitHub commenting process.

## Execution Protocol

### 0. Branch Scope Lock (MANDATORY — Before anything else)

**CRITICAL RULE**: You MUST ONLY review code from the `$ARGUMENTS` branch's — or the CURRENT branch's if no arguments were given — commits that diverge from the target branch (usually `main`).

Steps:

1. Run `git branch --show-current` to identify the current branch.
2. Run `git merge-base main HEAD` to find the common ancestor.
3. Run `git log --oneline <merge-base>..HEAD` to list ONLY the commits unique to this branch.
4. Run `git diff <merge-base>..HEAD --name-only` to get the list of changed files.
5. ALL review analysis MUST be scoped exclusively to these changed files and these commits.
6. NEVER review, comment on, or flag issues in code that was NOT changed in this branch's commits.
7. If a file was only partially modified, only review the changed lines and their immediate context.

This ensures the review is focused, actionable, and doesn't generate noise from pre-existing code.

### 1. Context Discovery (Haiku agent)

**Action**: Scan the repository to identify existing tools and architectural patterns. For this repo specifically, read `CLAUDE.md` and `docs/diary.md` (the live ADR record).

**Goal**: Determine established conventions (export styles, error handling, the in-repo `pipe()` / `Result<T,E>` helpers per ADR-024, security-header stack per ADR-013).

### 2. Change Summarization (Sonnet agent)

**Action**: Summarize the branch's changes (scoped to commits from step 0), focusing on new endpoints, DB queries, security-critical code paths, and any cross-cutting concerns.

### 3. Parallel Specialized Reviews (5 sub-agents)

All agents MUST only analyze code within the branch scope defined in step 0.

#### Agent 1 — Security Sentinel (Opus/Sonnet)

Audit for SQL/NoSQL/Prompt Injections. Ensure strict input validation/sanitization. For this repo, also check: ADR-013 security-header stack on every viewer response, ADR-014 service-worker block at the edge, ADR-015 SVG rejection, ADR-016 API-key scopes.

#### Agent 2 — API & CRUD Contract Manager (Sonnet)

Verify CRUD symmetry, HTTP status codes, and DTO data leaks. For this repo, also check OpenAPI contract changes (`docs/api/openapi.yaml`) when API routes change.

#### Agent 3 — Pattern & Refactor Enforcer (Sonnet)

Check adherence to existing patterns. Identify code that can be simplified or modularized. For this repo, specifically: ADR-024 (no fp-ts/Effect/Remeda — vanilla TS + in-repo `pipe()` and `Result<T,E>`), ADR-020 (hexagonal — domain has no I/O), readonly on domain types.

#### Agent 4 — Simplicity Advocate (Sonnet)

Actively look for ways to reduce code complexity and volume. For every piece of new code, ask: "Is there a simpler way to achieve the same result with less code?" Prioritize:

- Removing unnecessary abstractions, wrappers, or indirections that don't add value.
- Replacing verbose logic with concise alternatives (built-in methods, fewer branches).
- Eliminating dead code, redundant checks, or over-engineered patterns.
- Suggesting inline solutions over extracted helpers when the helper is used only once.
- Flagging premature generalizations — code that handles hypothetical future cases instead of the current need.

The goal is: less code to read, less code to maintain. Simpler code is easier to review, test, and debug.

#### Agent 5 — Test Hygiene Inspector (Sonnet)

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

**Constraint**: Ignore nitpicks. Focus on vulnerabilities, broken contracts, major pattern deviations, duplicated test setup, missing tests, redundant tests, and simplification opportunities that meaningfully reduce code volume or complexity.

### 5. Severity-Based Summary Report (MANDATORY)

After all agents complete, you MUST present findings organized into exactly 4 severity categories with a count summary table:

```
### Review Summary

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | X | Security vulnerabilities, data leaks, broken functionality |
| HIGH     | X | Missing tests, broken contracts, major pattern violations |
| MEDIUM   | X | Redundant tests, unnecessary complexity, code duplication |
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
