# Claude Code instructions for this repository

These instructions are binding for any Claude or LLM-driven agent working in this repo. They mirror the architectural decisions in `docs/spec.html` (rev 7, 30 ADRs).

## At session start

**Read `docs/diary.md` first.** It carries the current state (phase, last commit, active worktrees, open questions, live infrastructure), and a chronological history of every material decision and milestone. The "Current state" block at the top is the agent re-orientation summary; the entries below are the why-we-got-here.

If the diary disagrees with anything in this file or in `docs/spec.html`, the spec wins (it's the contract); the diary is the running log. Flag the contradiction in your next entry rather than papering over it.

**Diary update protocol** (when YOU finish work that materially changes state):
- Phase milestone reached → append a dated entry to `docs/diary.md`.
- ADR added, decision reversed, vendor changed → append.
- Worktree created for a non-trivial feature → note it in the next entry; remove from the active list when merged.
- Infrastructure applied (anything beyond `tf.sh init`) → append with env, plan diff summary.

## Before any change

1. **Use a git worktree** (ADR-025). Never edit files in the root checkout for in-progress work.

   ```bash
   # From the project root (~/PetProjects/ai-report-platform/)
   git worktree add worktree/<slug> -b <type>/<slug>
   cd worktree/<slug>
   ```

   Worktrees live under `worktree/` inside the project (gitignored). `<type>` is one of `feat`, `fix`, `refactor`, `chore`, `docs`. Examples: `feat/phase-0b-tf-modules`, `fix/r2-roundtrip-test`, `docs/adr-031-foo`.

2. **Start with `/tdd`** for any code change (Phase 0e). Write the failing test first, then implementation, then refactor. See `.claude/skills/tdd/SKILL.md`.

3. **Read the relevant ADR** before changing infrastructure or security code. ADRs live in `docs/adr/`. Currently 30 records; the full spec is in `docs/spec.html`.

4. **Use Conventional Commits** (ADR-033). Every commit must start with one of `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`, optionally followed by `(scope)`, then `:`, then a subject ≤100 chars. Examples: `feat(headers): add Trusted Types policy`, `fix(viewer): block service worker registration`, `chore(deps): bump turbo to 2.5.4`. `feat` drives a minor bump on merge, `fix`/`perf` drive patch, `BREAKING CHANGE:` in the body drives major; everything else ships under the next release without bumping. **Merges to `main` are rebase-only** (ADR-033 revised) — every PR commit lands on `main` verbatim, so each one must individually follow the format. The local husky `commit-msg` hook lints commits at write time; the CI `commitlint` workflow re-lints every commit in the PR as belt-and-braces. **Curate your commits before opening the PR** (`git rebase -i`) so the on-main history reads cleanly — if you have a "fix typo" or "address review feedback" commit, squash it locally first.

## Style

- **Functional, immutable** for `packages/domain/` and `packages/application/` (ADR-024). No new FP libraries — vanilla TS + 12-line `pipe()` + 15-line `Result<T, E>`.
- **`readonly` on every domain type.** ESLint will fail the build otherwise.
- **No side effects in domain code** — push all I/O to `packages/adapters/`.
- **Repository pattern** for data access (ADR-020). Drizzle implementations live in adapters, not in use cases.

## Before `git push`

1. Run `/docs-check` (or let `docs-prepush-guard.sh` fire). The doc-trigger matrix is in ADR-026:
   - Schema change → `docs/db-design.md` + ADR if non-trivial
   - New API route → `docs/api/openapi.yaml` + Bruno regen
   - New use case → `tests/e2e/features/*.feature` + README entry
   - New event → `docs/events.md`
   - New ADR → `docs/adr/INDEX.md` link
   - `.claude/skills/**` or `.claude/hooks/**` → `CLAUDE.md` update
   - `infra/terraform/**` → `docs/infra.md` + ops runbook

2. CI will run: biome, typecheck, branch-name, unit, e2e, security-headers, Bruno contract, docs-trigger-matrix. The local pre-push hook runs a subset.

3. PRs receive **automated review from Claude and Gemini** (ADR-030). Per ADR-032 (solo-developer mode), human approval is **not required to merge** — the PR mechanism itself is the gate, alongside CI status checks. CODEOWNERS at `.github/CODEOWNERS` is informational (ownership map for future contributors); when a second developer joins, flip `required_approving_review_count` back to `1` in `infra/terraform/modules/github-repo/main.tf`.

## Infrastructure

- **Everything-as-code** (ADR-017). No clicking in dashboards except the one-time bootstrap R2 bucket and per-provider PATs. See `docs/infra.md`.
- **All `terraform` invocations through `infra/terraform/scripts/tf.sh`** (ADR-018). The wrapper acquires a Postgres advisory lock on Neon to prevent parallel applies from corrupting state.
- **Infrastructure-first delivery** (ADR-019): every PR runs against real infrastructure. No mocks for external services in e2e tests.

## Boundaries

This repo IS NOT:

- A Bash playground for `curl | bash` shenanigans. Never fetch and execute remote code.
- A place to add runtime dependencies casually. Each new dependency goes through PR review (Claude + Gemini, plus the operator's own read-through) and may require an ADR — especially for the domain/application layers, which are dependency-locked.
- A place to bypass branch protection. `PUSH_WITHOUT_DOCS=1` exists as the only escape hatch for `docs-prepush-guard.sh`; it logs to the PR and flags it in audit.

## Quick reference

| If you need to…                          | Skill / hook / doc                              |
| ---------------------------------------- | ----------------------------------------------- |
| Write code                               | `/tdd <task>` (ADR-022)                         |
| Open a PR                                | `git worktree add worktree/<slug> -b feat/<slug>` |
| Check docs are in sync                   | `/docs-check`                                   |
| Update API surface                       | Edit `docs/api/openapi.yaml`; Bruno auto-regens |
| Provision new infrastructure             | `infra/terraform/scripts/tf.sh <env> plan`      |
| Clean up old worktrees                   | `/worktree-cleanup`                             |
| Find an ADR                              | `docs/adr/INDEX.md`                             |

If something here conflicts with `docs/spec.html`, **the spec wins**. Update this file.
