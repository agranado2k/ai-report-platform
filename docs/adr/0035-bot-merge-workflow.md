# ADR-0035: Bot-merge workflow for signed-commits + rebase-merge

- **Status**: Accepted
- **Date**: 2026-06-03
- **Deciders**: agranado2k
- **Supersedes / amends**: ADR-025 (signed commits) and the project's rebase-merge convention. Both stay in force; this ADR resolves the interaction between them.
- **Superseded by**: —

## Context and problem statement

`main` branch protection requires `require_signed_commits = true` (per ADR-025) and only allows `Rebase and merge` per project convention (so every PR commit lands on `main` verbatim). When the operator clicks **Rebase and merge** in the GitHub UI, the server-side rebase rewrites each commit's committer date and produces new commit objects. The original signatures verify the original objects, not the rewritten ones; GitHub cannot re-sign the new objects because only the operator holds the private key. Branch protection rejects the resulting unsigned commits and the PR fails to merge.

This is a documented, long-standing GitHub limitation, not a configuration issue.

A previous attempt (recorded in `docs/diary.md` 2026-06-03) tried to resolve this via GitHub Merge Queue, which signs rebased commits with GitHub's web-flow key. Merge Queue requires the repository to be owned by an organization; this repository is owned by a user account, and the underlying API rejects `merge_queue` rule creation with a 422 regardless of payload. That approach is rejected; this ADR replaces it.

## Decision drivers

- Preserve `require_signed_commits = true` on `main` (ADR-025).
- Preserve rebase-merge semantics so every PR commit lands on `main` verbatim and feeds `semantic-release` (rebase-merge convention).
- Avoid moving the repository to an organization for the sole purpose of unlocking Merge Queue.
- Keep the merge mechanism as simple as possible for a solo developer.

## Considered options

1. **Drop `require_signed_commits`** — Single Terraform line. Trade signing for UI rebase-merge working.
2. **Switch to squash-merge** — GitHub web-flow auto-signs squash commits. Trade per-commit history for signed commits.
3. **Custom bot-merge workflow** *(chosen)* — Workflow uses GitHub's git/commits REST API to create web-flow-signed copies of each PR commit on top of `main`; updates `refs/heads/main` via an operator-scoped PAT that is in `bypass_pull_request_allowances`. Preserves both ADRs.
4. **Transfer repository to a GitHub organization → enable Merge Queue** — Unblocks the path the earlier merge-queue attempt tried to take. Requires reconciling Vercel, GitHub App installs, and Terraform state.

## Decision outcome

**Chosen: Option 3 — custom bot-merge workflow** at `.github/workflows/bot-merge.yml`.

Key insight: GitHub's git/commits REST API automatically web-flow-signs every commit it creates. We never sign anything ourselves; we ask the API to create the commits and GitHub's web-flow identity signs them. The resulting signatures satisfy `require_signed_commits`.

Mechanism:

1. Operator comments **`/merge`** on a green PR.
2. Workflow validates: comment author has write access, PR is open and mergeable, PR base equals current `main` HEAD.
3. For each commit in PR order, the workflow `POST /repos/{owner}/{repo}/git/commits` with the original tree, message, and author; parent is seeded as `main`'s HEAD and chained through subsequent commits.
4. Workflow `PATCH /repos/{owner}/{repo}/git/refs/heads/main` to the new HEAD with `force=false`.
5. Workflow verifies `commit.verification.verified == true` for the new HEAD and posts a result comment on the PR.

Auth: the workflow uses `MERGE_BOT_TOKEN`, a fine-grained PAT scoped to this repository with `Contents: write` + `Pull requests: write` + `Metadata: read`. The PAT belongs to the operator (`agranado2k`), and `agranado2k` is added to `bypass_pull_request_allowances` inside `required_pull_request_reviews` in the `github_branch_protection.main` resource so the PATCH is permitted despite the PR requirement.

### Consequences

**Positive**

- Both ADR-025 (signed commits) and the rebase-merge convention (per-commit history) remain in force unchanged.
- Every commit on `main` is "Verified" in the GitHub UI.
- `semantic-release` sees the same commit granularity as before.
- No GitHub App registration, no SSH/GPG key generation, no signing server. Maintenance surface is one workflow file plus one PAT.

**Negative**

- The merge mechanism is a custom workflow rather than a built-in GitHub button. New contributors must be told to comment `/merge` instead of clicking **Rebase and merge** (documented in `CLAUDE.md` rule 4).
- The `MERGE_BOT_TOKEN` PAT must be rotated periodically and re-issued on operator account changes (documented in `docs/ops.md` runbook).
- Custom code path means responsibility for handling edge cases (PR base drift, concurrent `/merge` calls) sits with us. Mitigated by `force=false` on the ref PATCH and `concurrency.group: bot-merge-main` on the workflow.

**Neutral**

- `enforce_admins = true` stays on; bypass is granular (one user listed explicitly), not blanket.
- All other branch-protection invariants — `required_linear_history`, `allows_force_pushes = false`, `allows_deletions = false`, `require_conversation_resolution`, `required_pull_request_reviews` (count = 0 per the solo-developer policy) — remain in force.

## Pros and cons of the options

### Option 1 — Drop `require_signed_commits`

- Pro: Smallest change (one Terraform line).
- Pro: GitHub UI **Rebase and merge** works immediately without further code.
- Con: Lose cryptographic provenance for commits on `main`. Tamper-evidence depends entirely on GitHub account integrity + 2FA.
- Con: Reverses ADR-025's intent for no operational gain.

### Option 2 — Switch to squash-merge

- Pro: GitHub web-flow auto-signs the squash commit.
- Pro: Smallest change.
- Con: Reverses the rebase-merge convention. PR commits collapse into a single commit on `main`.


- Con: `semantic-release` sees one bullet per PR even when the PR did multiple typed things.

### Option 3 — Custom bot-merge workflow *(chosen)*

- Pro: Preserves both ADRs unchanged.
- Pro: Self-contained; no external infrastructure.
- Con: ~140 lines of custom YAML to maintain.
- Con: PAT management overhead.

### Option 4 — Transfer repository to a GitHub organization

- Pro: Unblocks Merge Queue (the path the earlier merge-queue attempt tried to take).
- Pro: Lowest-code long-term path if more developers join.
- Con: 30–60 minutes of Vercel / GitHub App / Terraform state reconciliation now.
- Con: Solo-dev velocity unchanged; pays cost without proportional benefit until a second developer joins.

## More information

- The GitHub UI **Rebase and merge** signature-loss behavior is documented in GitHub community discussion [#11639](https://github.com/orgs/community/discussions/11639) (open since 2020) and [#39886](https://github.com/orgs/community/discussions/39886) (still active as of February 2026).
- The merge-queue-on-user-repos restriction is documented at [Managing a merge queue — GitHub Docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue).
- The development chronology for the iteration that led to this ADR is recorded in `docs/diary.md` (2026-06-03 entries).
- One-time operator setup (PAT issuance, secret population, smoke test) is recorded in `docs/ops.md` and referenced from the diary entry that lands this ADR.
