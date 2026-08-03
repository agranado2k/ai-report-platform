# ADR-0077: Operator-side merge train + worktree lifecycle cleanup

- **Status**: Accepted
- **Date**: 2026-08-03
- **Deciders**: agranado2k
- **Supersedes / amends**: complements ADR-0044 (signed merge commits) and ADR-025 (worktree-per-feature); does not change either. Records the third merge-automation evaluation after ADR-0035's two.

## Context and problem statement

Parallel agent development (ADR-025 worktrees + `/pr-iterate`) automates everything up to and after the merge, but two lifecycle gaps concentrate manual toil and risk at the landing step:

1. **Worktree lifecycle is unowned.** Agents create `worktree/<slug>` reliably; nothing removes them or syncs the root checkout after merge. Observed on 2026-08-03: 7 worktrees, **all** of whose branches were already merged (PRs #222–#237); root `main` 4 days / 7 PRs behind `origin/main`; the `/worktree-cleanup` command referenced in `CLAUDE.md`'s quick-reference did not exist. New worktrees branched from stale `main` pay a merge-reconciliation tax later (12 `Merge remote-tracking branch 'origin/main'` commits cluster on the high-velocity days).
2. **Landing a green batch is N manual clicks, unordered.** `/pr-iterate` hard-rules "never merge", so the operator clicks "Create a merge commit" per PR (observed: 4 merges by hand inside a 39-second window on 2026-07-28). Each merge makes surviving PRs stale, and every merge auto-applies Drizzle migrations to prod (`migrate-db.yml`), so cross-PR migration collisions (`drizzle/meta/_journal.json`) make **merge order matter**.

This evaluation was prompted by reviewing [`funador/claude-code-merge-queue`](https://github.com/funador/claude-code-merge-queue), a local FIFO merge queue for parallel Claude Code agents.

## Decision drivers

- Branch protection is untouchable: `require_signed_commits = true`, `enforce_admins`, merge-commit strategy (ADR-0044). Any mechanism must merge through GitHub's own signed paths.
- The PR is the quality gate: preview isolation (ADR-0047), migration-check, e2e, dual AI review (ADR-030) only run on PRs. No merge path may bypass them.
- Prod safety: `migrate-db.yml` runs on every merge to `main`; migration ordering across a batch must be observed, and a failed prod migration must halt further landings.
- The operator stays the initiator (solo-dev policy); only the mechanical clicking is delegated.

## Considered options

1. **Adopt `claude-code-merge-queue` (npm)** — worktree "lanes" + PID-lock FIFO; its `land` rebases onto the integration branch and **pushes directly, no PR**, gated by one local `checkCommand`.
2. **GitHub Merge Queue** — already attempted and rejected (ADR-0035): requires an org-owned repo; the API 422s on this user-owned repo.
3. **Bot-merge** — already attempted and failed (ADR-0044): `bypass_pull_request_allowances` returns HTTP 500 on user-owned repos.
4. **Status quo** — manual clicking, manual (never-happening) worktree cleanup.
5. **Operator-side merge train + cleanup tooling** *(chosen)* — skills/scripts that drive GitHub's normal signed APIs, invoked explicitly by the operator.

## Decision outcome

**Chosen: Option 5.** Two tools, both operator-invoked:

- **`scripts/worktree-cleanup.sh` + `/worktree-cleanup`** (makes the existing `CLAUDE.md` reference real): fetch + prune; fast-forward the root checkout's `main` (skipped if dirty or not on `main`); remove each `worktree/<slug>` whose branch is merged into `origin/main` **and** whose tree is clean (squash merges detected via the branch's merged PR, since squashing breaks ancestry); reinstall deps when `main` moved; then refresh the diary's "Active worktrees" row. Never force-removes.
- **`/merge-train`**: land a batch of green PRs serially — migration-bearing PRs (`packages/db/drizzle/**`) first and one at a time, two-migration batches escalate; stale PRs updated via GitHub's **update-branch API** (web-flow-signed merge commit — never a local rebase, which strips signatures, the exact ADR-0044 failure); merge via `gh pr merge --merge` (API merge commits are web-flow-signed, identical to the UI button); wait for `migrate-db.yml`/`release.yml` on `main` between merges and **stop the train on a migration failure**; finish with `/worktree-cleanup`. `/pr-iterate`'s "never merge" rule is unchanged — `/merge-train` is the separate, explicitly delegated merge step, consistent with the solo-dev policy that "the PR mechanism itself is the gate."

Option 1 is **rejected for this repo**: rebase + direct push to the integration branch is impossible under `enforce_admins` + signed commits, and a local `checkCommand` cannot replace the PR-only gates (Neon preview isolation, migration-check, e2e, AI reviews). Its `prune`/`sync`/FIFO-landing ideas are what the two tools above adapt to a PR world.

### Consequences

- ✅ A green batch lands with one skill invocation; ordering, staleness updates, and prod-migration observation are systematic instead of manual.
- ✅ Worktree/branch/diary drift self-heals after every train (or standalone `/worktree-cleanup`).
- ✅ Nothing changes in branch protection, Terraform, or CI; signatures preserved end to end.
- ⚠️ The train is only as safe as its green-check gate; advisory bot reviews still don't block (unchanged policy, ADR-030).
- ⚠️ Single-flight by design: a train serializes on prod workflows, so a big batch takes wall-clock time proportional to CI + migrate + release per PR. Accepted — that serialization is the point.

## More information

`claude-code-merge-queue` remains a reasonable zero-cost fit for repos with **no** branch protection or PR requirement (early-phase side projects where a local test command is the whole gate). It is a small third-party npm package that installs git hooks — vet before adopting anywhere.
