# ADR-0044: Use signed merge commits instead of rebase-merge + bot-merge

- **Status**: Accepted
- **Date**: 2026-06-09
- **Deciders**: agranado2k
- **Supersedes / amends**: supersedes ADR-0035 (bot-merge workflow) and amends ADR-025 (drops the linear-history requirement).
- **Superseded by**: —

## Context and problem statement

ADR-025 required a **linear history** with **signed commits** on `main`, and the only merge method enabled was **rebase-merge**. But GitHub's "Rebase and merge" button **rewrites** each PR commit into a brand-new object on `main` (new committer/parent) and **does not sign it** — so with `require_signed_commits = true`, every rebase merge is rejected with:

> Base branch requires signed commits. Rebase merges cannot be automatically signed by GitHub.

ADR-0035 tried to keep rebase-merge + signatures by routing merges through a `bot-merge.yml` workflow that recreates each commit signed and pushes `main` via the `agranado2k` identity. That approach **does not work on this repo**: it's a **personal (non-org) repository**, and the GitHub API for `bypass_pull_request_allowances` returns **HTTP 500** on user-owned repos, so the bot can't push to the protected branch. In practice every merge so far required manually toggling `require_signed_commits` off, merging, and toggling it back — which lands **unsigned** commits on `main`, defeating the requirement.

We need a merge path that produces signed history on `main` through the normal GitHub UI, with no bot and no manual protection toggling.

## Decision drivers

- Every commit on `main` must stay **signed** (`require_signed_commits = true` is non-negotiable).
- Merging must work through the **standard GitHub UI**, with no bot, no manual protection toggle, no personal-repo-only API.
- Preserve **per-commit history** (Conventional Commits → release notes), not collapse to one squashed commit.
- Stay **everything-as-code** (ADR-017): the policy lives in the `github-repo` Terraform module.

## Decision outcome

**Switch `main` to a merge-commit strategy and drop the linear-history requirement.**

- `allow_merge_commit = true` — the merge button creates a merge commit. GitHub **web-flow signs the merge commit**, *and* the PR's own commits land on `main` **verbatim with their existing signatures**. So `require_signed_commits` is satisfied natively, with no bot.
- `allow_rebase_merge = false` — rebase is the one method GitHub can't sign; drop it.
- `allow_squash_merge = true` — GitHub refuses to leave merge-commit as the *sole* method ("you must allow squash or rebase"). Squash is the safe second option (also web-flow-signed). Default to **"Create a merge commit"**; use squash only to collapse a noisy PR.
- `required_linear_history = false` — merge commits are non-linear by definition; the rule would block the merge button. Accepted trade-off: `main` gains merge bubbles.

`require_signed_commits`, `enforce_admins`, and the solo-dev `required_approving_review_count = 0` are **unchanged**.

### Consequences

- ✅ Merges work through the GitHub UI; `main` stays fully signed (merge commit + the original signed PR commits).
- ✅ Per-commit history preserved; semantic-release still sees every typed commit.
- ✅ No bot, no manual `require_signed_commits` toggling.
- ⚠️ `main` history is **non-linear** (merge bubbles). This reverses ADR-025's linear-history goal — accepted as the cost of native signing on a personal repo.
- 🧹 `bot-merge.yml` and the `/merge` comment flow (ADR-0035) are **obsolete**; the `pull_request_bypassers = [merge_bot]` entry in branch protection is now vestigial (harmless). Both are slated for removal in a follow-up PR.

### Operational note

Settings live in `infra/terraform/modules/github-repo/main.tf` (`allow_merge_commit`/`allow_squash_merge`/`allow_rebase_merge` on the repo; `required_linear_history` on the branch protection). They were applied live via the API to unblock open PRs and mirrored here so `tf.sh shared apply` reconciles to the same state (no drift).

## Alternatives considered

- **Squash-merge only** — web-flow-signed and keeps linear history, but collapses each PR to a single commit, losing per-commit granularity. Rejected as the default; kept enabled as the secondary method.
- **Fix the bot-merge workflow** — blocked by the personal-repo `bypass_pull_request_allowances` HTTP 500; would also require either an org migration or a GitHub App. Not worth the complexity versus native merge commits.
- **Local fast-forward push during a protection window** — preserves signed + linear history, but is a manual, protection-toggling ritual per merge; not a durable policy.
