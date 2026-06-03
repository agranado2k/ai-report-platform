---
name: pr-iterate
description: One closed-loop iteration on an open PR — read CI checks + Claude / Gemini / human review comments, triage against this repo's ADRs, apply valid suggestions, reply with reasoning on rejected ones, push fixes as Conventional Commits, and report status. Invoke as `/pr-iterate <PR#>`. Compose with `/loop /pr-iterate <PR#>` for continuous monitoring until green.
---

# /pr-iterate — closed-loop PR drive-to-green

## What this does

Runs **ONE iteration** of: snapshot → triage → act → poll. Designed to be re-fired by `/loop` for continuous monitoring, or invoked manually after a push to clean up bot feedback.

The goal is to get the PR to a state where:

- All required CI checks are green.
- Every actionable bot review comment has been either applied or replied to with reasoning.
- Every human thread has a response.

When that state is reached, you stop. You **never merge** — that's the operator's call via the GitHub UI (branch protection still gates merging on green checks).

## Hard rules — do not break

1. **NEVER** `git push --force`, `git commit --no-verify`, or modify branch protection.
2. **NEVER** merge the PR. GitHub's UI + branch protection is the merge gate.
3. **NEVER** apply a bot suggestion that contradicts an ADR without escalating to the operator first.
4. **ALL** commits must be Conventional Commits (ADR-033): `feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert(scope): subject` (subject ≤100 chars). The husky `commit-msg` hook will reject otherwise — that's the safety net.
5. **One logical change per commit** — merges to `main` are rebase-only (ADR-033 revision), so every commit lands on `main` verbatim and shows up in the next release notes.
6. **When in doubt, escalate**. Write a one-line summary of the conflict, stop the iteration, surface to the operator.

## Prerequisites — check at the top of every iteration

```bash
# Worktree clean?
git diff --quiet && git diff --cached --quiet || { echo "uncommitted changes — abort"; exit 2; }

# Are we on the PR's branch?
PR_BRANCH=$(gh pr view "$PR" --json headRefName --jq .headRefName)
[[ "$(git branch --show-current)" == "$PR_BRANCH" ]] || { echo "wrong branch — abort"; exit 2; }

# Is local up to date with origin? (Avoid working on stale state.)
git fetch origin
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$PR_BRANCH")
[[ "$LOCAL" == "$REMOTE" ]] || { echo "local behind / ahead of origin — pull first"; exit 2; }
```

If any check fails, surface a clear one-line message and stop.

## Procedure

### 1 — Snapshot the PR

```bash
# Aggregate state in one place
gh pr view "$PR" \
  --json title,statusCheckRollup,reviews,comments,headRefName,headRefOid,baseRefName,reviewDecision,mergeable,mergeStateStatus

# Per-check details + URLs to logs
gh pr checks "$PR"

# Inline review-thread comments (different endpoint than top-level .comments)
gh api "repos/{owner}/{repo}/pulls/$PR/comments" --paginate
```

Bucket what you find:

- **Failing / pending checks** → name, conclusion, URL to logs
- **Bot review threads** from `claude[bot]`, `claude-review[bot]`, `gemini-cli[bot]`, `gemini-review[bot]` (and any other `*[bot]` accounts)
- **Human threads** — anyone who isn't a `[bot]`
- **Top-level PR comments** vs **inline review-thread comments** — they live in different endpoints and reply differently

### 2 — Independent code review (`/review-and-evaluate`)

Before triaging external bot comments, invoke **`/review-and-evaluate`** locally to get our own project-aware reading of the diff. The skill runs two parallel agents:

1. **PR Reviewer** — via `.claude/skills/review-pr/SKILL.md`; 5 specialized sub-agents (Security, API/CRUD, Pattern, Simplicity, Test hygiene) produce a severity-bucketed finding list.
2. **Context Alignment Analyst** — reads the commits, the changed files, `CLAUDE.md`, and `docs/diary.md` (the ADR record), then evaluates each finding for **Apply / Skip / Discuss**.

The skill normally ends interactively ("Which items would you like me to apply?"). **In the `/pr-iterate` context, bypass the question** and consume the verdicts directly:

| Verdict from `/review-and-evaluate` | What `/pr-iterate` does with it |
|---|---|
| **Apply** | Add to the iteration's Act list — fix it via one Conventional Commits commit. |
| **Skip** | Record it in the iteration report ("not applied — reason: …") and move on. |
| **Discuss** | Add to the escalation list. Don't apply; surface to operator at end of iteration. |

The local review is **complementary** to the bot reviews from `claude-review` / `gemini-review`. They look at the same diff with different lenses:

- **Bot reviews**: third-party AI, prompted with generic-plus-ADR context, posts inline GitHub comments.
- **`/review-and-evaluate`**: our own skill run, fresh per iteration, has full local file access + the live diary content.

Treat them as two independent reviewers. If both flag the same issue → almost certainly worth applying. If they disagree → it's a Discuss/escalation candidate.

### 3 — Triage

**For each failing check:**

```bash
# Find the run-id from the check URL or:
gh run list --workflow=<workflow-file> --branch="$PR_BRANCH" --limit 1 --json databaseId,conclusion
gh run view <run-id> --log-failed   # cheapest — only the failing step's output
```

Classify the failure:

| Classification | Action |
|---|---|
| Build / install error (missing dep, lockfile drift) | Fix package.json or lockfile; commit `fix(deps): ...` |
| Typecheck error | Fix the type; commit `fix(types): ...` |
| Lint / format | Run the fixer; commit `style: ...` |
| Test failure — clear bug | Fix the bug; commit `fix(<area>): ...` |
| Test failure — test is wrong | Update the test, document in commit body; commit `test(<area>): ...` |
| Vercel deploy — env var / Corepack | Cross-reference the ADR-031 / ADR-033 carry-overs in the diary; usually a project-level config, not a code fix |
| Security / headers / CSP — spec violation | Read ADR-013, fix the route/middleware; commit `fix(security): ...` |
| I genuinely can't diagnose this from logs | Escalate. Don't guess at fixes. |

**For each bot review comment:**

Read the suggestion. Cross-reference with project policy:

- Read `CLAUDE.md` and `docs/diary.md` (the live ADR record).
- If the suggestion **improves** security / correctness / readability **and** doesn't contradict an ADR → **apply** it.
- If the suggestion **contradicts an ADR** (e.g. "use fp-ts" violates ADR-024, "squash to one commit" violates ADR-033, "remove signed commits" violates ADR-025) → **reply on the thread** with a one-line policy citation and the ADR number. Don't apply.
- If the suggestion is **ambiguous** (touches an open question, requires a design call) → **escalate**. Don't apply, don't reply, surface to operator.

**For each human comment:**

Answer it. Be direct, cite ADRs where relevant. Don't mark human threads resolved — only humans resolve human threads.

### 4 — Act

**For applied fixes:**

```bash
# One logical change per commit (rebase-merge friendly — every commit
# lands on main and shows up in release notes).
git add <specific files, not -A>
git commit -m "$(cat <<'EOF'
<type>(<scope>): <subject under 100 chars>

<body explaining why — reference the bot comment or check URL>
EOF
)"

git push   # no --force, no --no-verify
```

**Tooling reminders:**

- The husky `commit-msg` hook lints the message at write time. If it rejects, fix the message and retry — never `--no-verify`.
- `git push` to a feature branch is safe; never push to `main` from here.

**For replies on bot threads (inline review comments):**

```bash
# Reply to an inline review-thread comment
gh api \
  -X POST \
  "repos/{owner}/{repo}/pulls/$PR/comments/$COMMENT_ID/replies" \
  -f body="$REPLY_BODY"
```

**For replies on top-level PR comments:**

```bash
gh pr comment "$PR" --body "$REPLY_BODY"
```

**Resolving threads** (only for bot threads that are fully handled — code applied or policy cited):

```bash
# GraphQL — resolve a review thread
gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "..."}) { thread { isResolved } } }'
```

(Get the `threadId` from the `gh api` listing of review threads.)

### 5 — Wait

After pushing, CI takes 1–5 min. Two modes:

- **Manual single-shot** (`/pr-iterate <N>`): stop here, report status. The operator re-invokes when ready.
- **Loop mode** (`/loop /pr-iterate <N>`): the loop runner schedules the next iteration. Inside this iteration, return after step 3 + a brief status report. Don't sleep-poll inside one iteration.

If running manually and the operator asked you to wait for the result, use:

```bash
# Wait until no checks remain pending — bounded
until ! gh pr checks "$PR" 2>&1 | grep -qE 'pending'; do sleep 30; done
```

…but only if explicitly asked.

### 6 — Stop conditions

Stop iterating and report when ANY of:

- All required checks green **AND** no open bot threads **AND** no unanswered human threads → ✅ converged
- 5 iterations completed without convergence (likely stuck) → 🟡 escalate with diagnosis
- A bot suggestion conflicts with an ADR and you can't reply confidently → 🟡 escalate
- Branch protection blocks a legitimate operation → 🟡 escalate
- A check is failing in a way you can't diagnose from the logs → 🟡 escalate

## Output format

End every iteration with a one-screen summary the operator can read at a glance:

```
PR #<N> — "<title>" — iteration <i>

Status:
  Checks:        <green>/<total> green · <failing> failing · <pending> pending
  Bot threads:   <open>/<total> open  (claude: <X>, gemini: <Y>)
  Human threads: <unresolved>/<total>
  /review-and-evaluate verdicts:
    Apply: <X>  · Skip: <Y> · Discuss: <Z>

This iteration:
  Applied:    <list of fixes with commit SHAs; mark source: bot|local|check>
  Replied:    <list of bot threads with one-line reasoning each>
  Escalated:  <items needing operator judgment — includes Discuss verdicts>

Next: <continue / stop — converged / stop — escalation>
```

## Cross-references

- ADR-013 (security headers): `docs/diary.md` 2026-05-18 + the v7 spec
- ADR-014 (service worker block at edge): same
- ADR-024 (no fp-ts / Effect / Remeda): same
- ADR-025 (PR-only, signed commits, linear history): `infra/terraform/modules/github-repo/main.tf`
- ADR-030 (dual AI review — Claude + Gemini): `.github/workflows/claude-code-review.yml` + `.github/workflows/gemini-review.yml`
- ADR-032 (solo-dev branch protection — 0 approvals): `infra/terraform/modules/github-repo/main.tf`
- ADR-033 (Conventional Commits + semantic-release + rebase-merge): `commitlint.config.js` + `.releaserc.json` + `.husky/commit-msg`

Sibling skills this one invokes:

- **`/review-and-evaluate`** (`.claude/skills/review-and-evaluate/SKILL.md`) — the local review step inserted at iteration step 2.
- **`/review-pr`** (`.claude/skills/review-pr/SKILL.md`) — used internally by `/review-and-evaluate` for the 5-sub-agent review.

When citing an ADR in a reply, always include the number — future-me and future-collaborators will grep for it.
