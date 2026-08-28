# ADR-0084: Fill the capability-tier mapping, and `/implement` delivers to a reviewed PR

- **Status**: Accepted
- **Date**: 2026-08-28
- **Deciders**: agranado2k
- **Relates to**: ADR-0082 (layered constitution — the tier vocabulary is a root-manual rule, its rubric an article rule), ADR-030 (dual AI review — the review `/implement` now requests is already wired), ADR-0044 (merge policy — the boundary delivery stops at), ADR-0069 (trust boundary — a delegated untrusted read is one of the spawns that resolves a tier), ADR-0077 (`/merge-train` — landing stays operator-invoked). The tier **mechanism** (resolver `scripts/agents.lib.sh`, config `scripts/agents.config.sh`, the four-tier vocabulary, and the rubric in `constitution/local-workflow.md`) arrived with the agentic-sdlc v0.10.0 migration (PR #304); this ADR records the two decisions this repo makes **on top of** that mechanism.

## Context and problem statement

The v0.10.0 migration brought a capability-tier seam the repo did not have before: a resolver that maps a tier name to a model, a config file for the mapping, a closed four-tier vocabulary named in the root `AGENTS.md`, and a rubric in `constitution/local-workflow.md`. But it brought the seam **inert**, and two gaps remained.

**1. The mapping ships empty, so the seam costs nothing yet.** The kit ships `scripts/agents.config.sh` empty on purpose — a framework has no provider, and the cheap tier of one release is the expensive tier of the next. Left empty, every tier resolves to nothing and every spawn inherits the session's own model — which is the strongest model available, for a dependency bump as much as for a security review. The per-task model decisions this repo *already* makes still live only as English scattered through skill files (`review-pr` heads steps "(Opus)" and "(Haiku agent)"; `report-comments` says "one Opus 5 subagent"; `claude-code-review.yml` pins `--model claude-opus-4-8`), where nothing ties them together and nothing checks them — the exact decay `shared-invariants.md` §8 names.

**2. The skills do not use the seam.** The migrated `AGENTS.md` *promises* that "`/to-tickets` stamps a tier on every ticket … `/implement` reads its ticket's tier when it spawns" — but neither skill did. `/to-tickets` produced no `Tier:` line, and `/implement` stopped at the commit: its contract ended at "commit with Conventional Commits" and its boundary said it "does not open PRs". So the operator arrived at an unpushed branch and did the delivery by hand — push, `gh pr create`, fill the template, wait for the reviewers — which is the precise toil the `/to-prd` → `/to-tickets` → `/implement` chain exists to remove, and the toil that most reliably gets skipped: a branch that never becomes a PR never gets the ADR-030 dual review.

## Decision drivers

- **Close the gap between what the manual claims and what the skills do.** `AGENTS.md` already promises the stamping and reading; the skills must honour it or the manual is a lie.
- **Executable, not prose** (`shared-invariants.md` §8). A tier mapping that is only a config file nobody checks is a suggestion; one with a test is a mechanism.
- **One home per rule** (ADR-0082). A model identifier appears once — in the config — and the manual says only that this is where a tier's model is *configured*.
- **The stopping point must be visible and principled.** Moving `/implement`'s end forward is safe only if the new end is demonstrably still short of the merge.
- **Adopting the mapping must change no behaviour on day one.** The first commit moves where the decision lives, not what it is (§10).

## Considered options

**A. Leave the mapping empty; leave `/implement` ending at the commit.** Zero cost, and the status quo works. Rejected: it leaves the migrated seam inert and the `AGENTS.md` stamping/reading promise unfulfilled, and it keeps the delivery toil that suppresses the review this repo already pays for.

**B. Put model identifiers in the manual layer, as a table in `AGENTS.md`.** Visible every session. Rejected: the root manual is the most expensive real estate in the repo (ADR-0082), model ids rot fastest of anything that could live there, and a table in prose is unresolvable by a script — a skill would have to *read English* to decide what to pass to a spawn. The resolver + config already exist; use them.

**C. Fill `scripts/agents.config.sh` and wire the two skills to the resolver.** The mapping is data a human reads; `/to-tickets` stamps `Tier:` and `/implement` reads it and resolves spawns through `sh scripts/agents.lib.sh <tier>`. **Chosen.**

**D. Also re-point `/review-pr` and `/report-comments` at the resolver in this change.** Rejected *for this change*, kept as backlog: those skills' model names are correct today, re-pointing them is behaviour-preserving cleanup on a different surface, and §10 says it is its own ticket rather than a passenger on this one. What this ADR does is make one true home exist for them to move into.

For `/implement`'s ending, the alternative considered and rejected was **letting it also drive the PR to green** — read CI, triage review comments, push fixes. Rejected: `/pr-iterate` already owns that loop, two drivers on one PR is worse than none, and a session that re-enters its own diff puts the implementation narrative back in front of the review findings, which is the anchoring fresh context (§4) exists to prevent.

## Decision outcome

**Chosen: option C — fill the mapping (pinned by a test) and wire the two skills — plus a Deliver phase on `/implement` that ends at an open PR with the ADR-030 reviewers confirmed.**

### 1. The mapping is filled, and a test pins it

The vocabulary is closed — `planner`, `implementer`, `mechanical`, `reviewer`, named in `AGENTS.md`, rubric in `constitution/local-workflow.md`. This repo has one harness (Claude Code) and one provider, so all four are mapped in `scripts/agents.config.sh`, resolved by `sh scripts/agents.lib.sh <tier>` (model on stdout, diagnostics on stderr; an **unknown** tier exits 2 — a typo is not a policy choice). The mapping is derived from what this repo was **already** doing, so day one changed no behaviour:

| Tier | Model | Precedent it was taken from |
| --- | --- | --- |
| `planner` | `opus` | **No named precedent — the honest case.** Planner-shaped work runs in the operator's own session (`/to-prd`, `/to-tickets`), and where it *is* spawned (`/review-and-evaluate`) no model is named, so the spawn inherits that session — the top of the range in practice. The mapping records that, it does not change it. |
| `implementer` | `opus` | `/report-comments` Phase 3 — "one Opus 5 subagent per group", the repo's only recorded implementing-subagent choice |
| `mechanical` | `haiku` | `/review-pr` step 1, "Context Discovery (Haiku agent)" |
| `reviewer` | `opus` | all seven `/review-pr` sub-agents; `.github/workflows/claude-code-review.yml` |

Values are harness **aliases**, not dated identifiers, because the alias is what the spawn call takes (`/report-comments` already writes `model: opus`) and it tracks its family across a version bump. The one dated pin that stays is the CI reviewer's `--model claude-opus-4-8`: a workflow wants a reproducible review, not the newest one.

Three of four resolve to `opus`, and that is the honest reading of today's practice rather than a failure of the rubric. The value delivered on day one is the *seam*: re-pointing is now a one-file diff a reviewer reads, `mechanical` is genuinely cheaper, and `scripts/test/agents-mapping.test.mjs` (the `test:scripts` tier) fails if any tier is emptied or if `mechanical` and `reviewer` ever resolve to the same model — the cost seam made executable.

### 2. The tier is stamped at ticket-writing time

`/to-tickets` stamps `Tier:` on every ticket and shows the mix at its quiz for human override; `/implement` reads it and does not re-open it. An agent asked to size itself sees one ticket, never the wave's budget, and has every incentive to answer "the strongest one".

**A tier is not a permission.** It says which model runs the work, never how much autonomy it carries — `ready-for-agent` remains the only thing that says that. Ambiguity on the tier resolves **upward**, the opposite direction from the autonomy label: under-tiering is silent (a plausible wrong diff), over-tiering only costs money, and cost is visible.

### 3. `/implement` delivers, and stops one click short

Curate (`git rebase -i`) → push **through** `.husky/pre-push` → `gh pr create` filling `.github/pull_request_template.md`, carrying the step-1 restatement verbatim (Axis 2 reads it) and the demo evidence → **confirm** the reviewers fired with `gh pr checks` → report the PR URL and stop.

Two things shape this against a generic "open a PR":

- **The review is confirmation, not assumption.** ADR-030 is fully wired here with two vendors, so opening the PR **is** the request and the skill's remaining job is to *check* — `gh pr checks`, and name which reviewers ran. A local `/review-and-evaluate` survives only as a stopgap for the case where neither workflow fired, which is an infrastructure failure to report by name.
- **The title is Conventional Commits for ADR-0044's reasons**, not a squash subject: CI `commitlint` lints every commit in the PR, squash-merge is the secondary landing option, and the title is what the operator reads in the PR list.

**The boundary, stated so it can be checked:** the skill pushes, opens, and confirms. It never merges, never enables auto-merge, never resolves an Axis-2 confirm-list item (§5, human-only). Landing stays the operator's, via the ADR-0044 button or `/merge-train` (ADR-0077). Bypasses stay out of the path: `PUSH_WITHOUT_DOCS=1` / `PUSH_WITHOUT_TESTS=1` only defer a failure to CI, so they are never a way to get a branch out.

### Consequences

- **Good**: the migrated seam is now live — a model identifier has one home with a test that fails when it is emptied; the tier is reviewable on a ticket before any money is spent; `/implement` now ends where §7 says autonomy ends, and a finished ticket cannot skip the ADR-030 review by never becoming a PR. The `AGENTS.md` stamping/reading promise is now true.
- **Bad / accepted**: model identifiers stay outside the config in three files — `/review-pr` (two distinct models), `/report-comments`, and the deliberate CI pin. So the manual claims only that the config is where a tier's model is *configured*, never that it is the sole occurrence of a model name in the repo. That is deliberate scope discipline (§10), recorded here as the migration backlog; anyone tempted to "fix" it should do it as its own `refactor` ticket.
- **Bad / accepted**: `/implement` sessions now end further out, so a bad ticket produces a PR rather than a branch — mitigated by a PR being *more* visible than a branch, and by the confirm-list staying human-only.
- **Neutral**: three tiers resolving to the same model means the mechanism saves little today. It is a seam, and its value is realised the first time a wave of `mechanical` tickets runs.

## More information

- Mechanism (shared layer, from the v0.10.0 migration): `scripts/agents.lib.sh`. Mapping (local): `scripts/agents.config.sh`. Test: `scripts/test/agents-mapping.test.mjs` (`node --test`, the `test:scripts` tier).
- Rubric and practice: `constitution/local-workflow.md`, "Capability tiers — the cost/benefit call". Vocabulary: root `AGENTS.md`.
- The upstream kit (agentic-sdlc) ships the resolver and vocabulary and deliberately ships the mapping empty; this ADR is this repo's local decision to fill it and to wire the two skills the manual already describes.
