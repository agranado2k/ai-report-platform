# Local workflow — commits, merges, review, docs, diary

Project-specific elaboration of the root `CLAUDE.md`'s process rules. The root carries the
binding one-liners; this article carries the detail you need when you are actually doing
the thing.

## Commits

Conventional Commits, enforced twice: the local husky `commit-msg` hook lints at write
time, and the CI `commitlint` workflow re-lints **every** commit in the PR as
belt-and-braces.

- Type is one of `feat` `fix` `docs` `style` `refactor` `perf` `test` `build` `ci` `chore`
  `revert`, optionally followed by `(scope)`, then `: `, then a subject ≤100 chars.
- Examples: `feat(headers): add Trusted Types policy`,
  `fix(viewer): block service worker registration`, `chore(deps): bump turbo to 2.5.4`.
- Release mapping: `feat` → minor, `fix`/`perf` → patch, `BREAKING CHANGE:` in the body →
  major. Everything else ships under the next release without bumping.
- **Curate your commits before opening the PR** (`git rebase -i`) so the on-`main` history
  reads cleanly. A "fix typo" or "address review feedback" commit gets squashed locally
  first.
- Refactor-only and behavior-changing work never share a commit (`shared-invariants.md` §10).
  Checked, not merely asserted: `scripts/behavior-delta.sh` has a **Commit separation**
  section listing every commit on the branch whose type claims `refactor`/`style` while its
  own diff touches a contract artifact, and `/review-pr`'s Axis-2 confirm-list carries each
  one as a 🔀 MIXED COMMIT item for the human to split or relabel.

## Merging to `main` (ADR-0044, supersedes ADR-0035)

On a green PR, click the GitHub **"Create a merge commit"** button. GitHub web-flow
**signs the merge commit**, and the PR's own commits land on `main` with **their**
signatures intact — so `require_signed_commits = true` is satisfied natively, with no bot
in the loop.

- **Do NOT use "Rebase and merge".** GitHub never signs rebased commits, so it is rejected
  by branch protection; it is disabled at the repo level anyway.
- **Squash-merge** is enabled as a secondary option (also web-flow-signed). Use it only to
  collapse a genuinely noisy PR.
- `main` is **no longer linear** — merge bubbles are the accepted trade-off in ADR-0044.
- The old `bot-merge.yml` / `/merge` flow is obsolete: it never worked on this personal
  repo, because the bypass API returns HTTP 500.
- Landing a batch of green PRs serially is `/merge-train` (ADR-0077), followed by
  `/worktree-cleanup`.

## Before `git push`

1. `pnpm docs:check` — the `.husky/pre-push` hook runs it for you, alongside the TDD
   pairing guard.
2. CI runs the full set: biome, typecheck, branch-name, unit, e2e, security-headers,
   Bruno contract, docs conformance.

### The docs-trigger matrix (ADR-026)

| When you change…              | You must also update…                              |
| ----------------------------- | -------------------------------------------------- |
| Database schema               | `docs/db-design.md` + an ADR if non-trivial         |
| A new API route               | `docs/api/openapi.yaml` + Bruno regen               |
| A new use case                | `tests/e2e/features/*.feature` + README entry       |
| A new domain event            | `docs/events.md`                                    |
| A new ADR                     | `docs/adr/INDEX.md` link                            |
| `.claude/skills/**` or `.claude/hooks/**` | `AGENTS.md` (or the article that owns the rule) |
| `constitution/**` or any `AGENTS.md` | the other layers, so one home per rule survives: a root rule that grew gets its article; an article rule that became binding gets the root; a package rule gets the nested file. Never leave the same rule in two homes (ADR-0082) |
| `infra/terraform/**`          | `docs/infra.md` + the ops runbook                   |

The docs gate runs the agentic-sdlc v0.10.0 docs-conformance harness, but with a **recorded
local fork**: `scripts/docs-conformance/index.mjs` and `validators/claude-md-refs.mjs` are
taken verbatim from the kit, while `runner.mjs` and `context.mjs` are kept forked so the
eight local validators (ADR index/MADR, glossary, events, features, gherkin, OpenAPI) that
depend on `ctx.paths` — removed upstream — keep running. The fork is recorded in `VERSION`'s
deviation note; it can retire when the kit upstreams the docs-skeleton validators.

## Automated review (ADR-030 — fully wired)

Every PR gets **dual AI review**: Claude via `.github/workflows/claude-code-review.yml`
and Gemini via `.github/workflows/gemini-review.yml`. Both auto-run on PR open / sync /
ready / reopen and post inline review comments. The `@claude` mention bot
(`.github/workflows/claude.yml`) additionally answers in PR, issue, and review-comment
threads with `use_commit_signing: true`, so any commits it pushes satisfy branch
protection.

- Auth: `CLAUDE_CODE_OAUTH_TOKEN` (set by `/install-github-app`) and `GEMINI_API_KEY` (set
  by the Phase 0b Terraform) — both already in repo secrets.
- Under the solo-developer branch-protection policy (`required_approving_review_count = 0`),
  human approval is **not required to merge**: the PR mechanism plus CI status checks are
  the gate. Bot reviews are **advisory** and do not gate merge.
- `.github/CODEOWNERS` is informational (an ownership map for future contributors). When a
  second developer joins, flip `required_approving_review_count` back to `1` in
  `infra/terraform/modules/github-repo/main.tf`.
- Locally, `/review-and-evaluate` runs the two-axis review. **Axis-2 confirm-list items are
  human-only** — never auto-applied (`shared-invariants.md` §5).

## Capability tiers — the cost/benefit call

The root `AGENTS.md` names the four tiers (`planner`, `implementer`, `mechanical`,
`reviewer`) and where the mapping lives (`scripts/agents.config.sh`, empty until an operator
fills it in). This is the practice around them.

**The decision is made at ticket-writing time, by the planner, in the open** — not at spawn
time, and never by an agent about its own session. An agent asked to size itself has no view
of the wave's total budget and every incentive to say "the strongest one". `/to-tickets`
stamps a tier on every ticket and surfaces the whole set at its quiz step, which is where a
human overrides it.

The rubric, in the order to ask it:

1. **Is the definition of done checkable without judgement?** A rename, a codemod, a
   dependency bump, a mechanical migration of call sites — the suite is the oracle.
   ⇒ `mechanical`. This is the one that saves real money, and the most common ticket in an
   expand–migrate–contract wave.
2. **Does the ticket's outcome constrain other tickets?** Decomposition, a design decision, a
   schema, an interface everything else builds against. A wrong answer is paid for by every
   downstream session. ⇒ `planner`.
3. **Is the deliverable a verdict on a diff rather than the diff?** Fresh-context adversarial
   reading, the standards axis of a review. ⇒ `reviewer`.
4. **Otherwise** ⇒ `implementer`. The default, and defaulting is correct: an unsure planner
   picking the cheap tier turns a saving into a re-run, and a re-run costs more than the tier
   ever saved.

Two rules that keep the rubric honest:

- **Ambiguity resolves upward**, the opposite direction from the autonomy label (which
  resolves to human-in-the-loop). Under-tiering is silent — you get a plausible wrong diff —
  while over-tiering only costs money, and cost is visible.
- **A tier is not a permission.** It says which model runs the work, never how much autonomy
  the work carries. The `ready-for-agent` label is the only thing that says that, and a
  `mechanical` ticket with no label still stops for a human.

Unmapped is a working state: with `scripts/agents.config.sh` empty, every tier resolves to
nothing, the spawn inherits the session's own model, and the resolver warns once so the gap
is visible rather than assumed away.

## ADRs

ADRs live in `docs/adr/` using the [MADR template](https://adr.github.io/madr/), one file
per decision, named `NNNN-short-kebab-title.md`. `docs/adr/INDEX.md` is the registry and
must be updated in the same PR.

- ADR-001 through ADR-030 still live inside `docs/spec.html` pending extraction (the
  backlog is in `INDEX.md`); ADR-0035 onwards are standalone files.
- Several Phase 0c decisions are recorded as dated diary entries rather than standalone
  ADRs (they are listed in `INDEX.md`) — **they are still binding policy**.
- When a decision is reversed, do **not** edit the old ADR: write a new one and set the
  old one's status to `Superseded by NNNN`.
- **Architectural decision content never goes in the diary.** The diary is the
  chronological log; it may reference an ADR by number but is never the source of truth
  for a decision.

## Diary update protocol

Append a dated entry to `docs/diary.md` when **you** finish work that materially changes
state:

- Phase milestone reached.
- ADR added, decision reversed, vendor changed.
- Worktree created for a non-trivial feature → note it in the next entry, and remove it
  from the active list when merged.
- Infrastructure applied (anything beyond `tf.sh init`) → record the env and a plan-diff
  summary.
- A structural change to the agent operating manual itself (this article layer included).

Never edit old entries. If the diary contradicts `docs/spec.html`, the spec wins — flag
the contradiction in your new entry rather than quietly rewriting history.
