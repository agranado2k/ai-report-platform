# modules/github-repo — Repository + branch protection + CODEOWNERS + secrets.
#
# This is the "the rules themselves are reviewed via PR" module (ADR-025).
# Changes to branch protection or required status checks land here, go
# through the same PR pipeline as application code, and apply automatically
# on merge via the CD workflow.

terraform {
  required_providers {
    github = {
      source  = "integrations/github"
      version = "~> 6.4"
    }
  }
}

resource "github_repository" "this" {
  name        = var.repo_name
  description = var.description
  visibility  = var.visibility # "public" or "private"

  has_issues   = true
  has_projects = false
  has_wiki     = false

  # Merge-commit strategy (ADR-0044 — supersedes the rebase-merge choice of
  # ADR-0035 / linear-history of ADR-025).
  #   - allow_merge_commit = true  → the merge button creates a merge commit.
  #     GitHub web-flow SIGNS that merge commit, AND the PR's own commits land
  #     on main verbatim with THEIR signatures intact. So `require_signed_commits`
  #     is satisfied natively — no bot-merge workflow needed. This is what fixed
  #     the "rebase merges cannot be automatically signed by GitHub" wall: GitHub
  #     never signs rebased commits, and the bot-merge workaround can't push to a
  #     protected branch on a personal (non-org) repo (bypass API returns HTTP 500).
  #   - allow_squash_merge = true  → kept because GitHub refuses to leave
  #     merge-commit as the SOLE method ("must allow squash or rebase"); squash
  #     is the safe second option (web-flow-signed too). Use "Create a merge
  #     commit" by default; squash only to collapse a noisy PR.
  #   - allow_rebase_merge = false → dropped: it's the one method GitHub can't
  #     sign, so it can never satisfy require_signed_commits.
  # Per-commit history + semantic-release: a merge commit preserves every PR
  # commit (Conventional-Commits formatted via the husky hook), so release notes
  # still see each typed commit. Trade-off: main is no longer linear (merge
  # bubbles) — accepted in ADR-0044.
  allow_merge_commit     = true
  allow_squash_merge     = true
  allow_rebase_merge     = false
  allow_auto_merge       = true
  delete_branch_on_merge = true

  # When a PR is squash-merged, the single resulting commit drives
  # semantic-release. Take its SUBJECT from the PR title (which must be
  # Conventional-Commits-compliant — same rule as commits) and its BODY from
  # the squashed commit messages, so CC footers (e.g. BREAKING CHANGE) survive.
  # (Merge commits — the default — preserve each commit as-is, so this only
  # affects the squash path.)
  squash_merge_commit_title   = "PR_TITLE"
  squash_merge_commit_message = "COMMIT_MESSAGES"

  # We use signed-commit enforcement via branch protection rather than the
  # repo-level setting (which is dashboard-only).

  # Don't init the repo from a template — the seed commit comes from local push.
}

# Vulnerability alerts (Dependabot) — separate resource as of github provider v6.
resource "github_repository_vulnerability_alerts" "this" {
  repository = github_repository.this.name
  enabled    = true
}

# Required status checks are listed as strings matching the CI job names
# from .github/workflows/ci.yml. Order matters in the spec but not at runtime.
# Using github_branch_protection (v4 / GraphQL) rather than v3 (REST) — v4 is
# the recommended resource and supports the full ADR-025 ruleset.
resource "github_branch_protection" "main" {
  repository_id = github_repository.this.node_id # v4 needs node_id, not name
  pattern       = "main"

  required_status_checks {
    strict   = true # require branches to be up to date with main
    contexts = var.required_status_checks
  }

  # Solo-developer branch-protection policy: the PR mechanism is kept
  # (no direct pushes to main; signed commits + linear history still
  # apply), but human-approval-on-PR is dropped to 0 and the CODEOWNERS
  # gate is off. Rationale: with one developer, requiring an approving
  # review makes main unmergeable (GitHub won't let you approve your
  # own PR). AI review (ADR-030) + CI status checks are the gates that
  # remain. When a second developer joins, flip these back to `1` / `true`.
  required_pull_request_reviews {
    required_approving_review_count = 0
    dismiss_stale_reviews           = true
    require_code_owner_reviews      = false
    # No PR bypassers: merges go through GitHub's signed merge-commit button
    # (ADR-0044), which is the normal PR flow — nothing pushes to `main` out of
    # band. (The old `bot-merge` bypasser was removed with that workflow.)
  }

  enforce_admins                  = true # owner cannot bypass (ADR-025)
  require_signed_commits          = true # ADR-025; satisfied natively by signed merge commits (ADR-0044)
  require_conversation_resolution = true
  # Linear history is OFF (ADR-0044): merge commits are non-linear by
  # definition, and required_linear_history would block the merge button. The
  # trade-off (merge bubbles on main) is accepted to get natively-signed merges
  # without the (broken-on-personal-repo) bot-merge workflow.
  required_linear_history = false
  allows_force_pushes     = false
  allows_deletions        = false
}

# Merges to `main` use GitHub's signed merge-commit button (ADR-0044): the merge
# commit is web-flow-signed and the PR's commits keep their signatures, so
# `require_signed_commits = true` is satisfied with no bot. (This supersedes
# ADR-0035's bot-merge workflow, which never worked on this personal repo —
# the bypass-allowances API returns HTTP 500 — and has been removed.)

# NOTE: CODEOWNERS is committed as a normal file at `.github/CODEOWNERS`,
# NOT managed by Terraform. The earlier `github_repository_file` approach
# tried to PUT the file via the API, which branch protection (with
# enforce_admins = true) rejects: signed commits + PR required. Keeping
# CODEOWNERS in source means edits go through PRs like any other file
# change — no chicken-and-egg with the protection rule.

# GitHub Actions secrets — sensitive values consumed by CI/CD workflows.
resource "github_actions_secret" "this" {
  # Keys (secret names) are not sensitive — only values are. See the same
  # nonsensitive() pattern in modules/vercel-app/main.tf.
  for_each    = nonsensitive(var.actions_secrets)
  repository  = github_repository.this.name
  secret_name = each.key
  # `value` replaces the deprecated `plaintext_value` in github provider v6+.
  # Behavior is the same — the value is encrypted client-side before
  # transmission and stored encrypted at GitHub.
  value = each.value
}

# GitHub Actions variables — non-sensitive config consumed by workflows.
resource "github_actions_variable" "this" {
  for_each      = var.actions_variables
  repository    = github_repository.this.name
  variable_name = each.key
  value         = each.value
}
