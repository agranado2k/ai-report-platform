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

  # ADR-033 revision: rebase-merge only.
  #   - allow_merge_commit = false  → no merge-commits (would break the
  #     linear-history rule on branch protection anyway).
  #   - allow_squash_merge = false → squash-merge throws away every commit
  #     on the PR and writes a single one using the PR title. That collapses
  #     useful history (e.g. a debug-and-fix sequence) and means
  #     semantic-release only sees one commit per PR.
  #   - allow_rebase_merge = true  → each PR commit is replayed onto main
  #     in order, preserving full history while staying linear. Combined
  #     with the husky commit-msg hook (every commit Conventional-Commits
  #     formatted), semantic-release on the next push sees every typed
  #     commit and aggregates them into the release notes.
  allow_merge_commit     = false
  allow_squash_merge     = false
  allow_rebase_merge     = true
  allow_auto_merge       = true
  delete_branch_on_merge = true

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

  # Solo-developer mode (ADR-032): the PR mechanism is kept (no direct
  # pushes to main; signed commits + linear history still apply), but
  # human-approval-on-PR is dropped to 0 and the CODEOWNERS gate is off.
  # Rationale: with one developer, requiring an approving review makes
  # main unmergeable (GitHub won't let you approve your own PR). AI
  # review (ADR-030) + CI status checks are the gates that remain.
  # When a second developer joins, flip these back to `1` / `true`.
  required_pull_request_reviews {
    required_approving_review_count = 0
    dismiss_stale_reviews           = true
    require_code_owner_reviews      = false

    # ADR-035: the `agranado2k` user identity (authenticated via the
    # MERGE_BOT_TOKEN repo secret) bypasses the PR requirement so the
    # `bot-merge.yml` workflow can push the rebased + web-flow-signed
    # commits to `main`. Without this entry, the workflow's PATCH to
    # /git/refs/heads/main is rejected by branch protection even though
    # the API-created commits are signed.
    bypass_pull_request_allowances {
      users = ["agranado2k"]
    }
  }

  enforce_admins                  = true # owner cannot bypass (ADR-025)
  require_signed_commits          = true # ADR-025 + ADR-035 (kept via bot-merge.yml)
  require_conversation_resolution = true
  required_linear_history         = true
  allows_force_pushes             = false
  allows_deletions                = false
}

# ADR-035: keep `require_signed_commits = true` AND rebase-merge by
# routing every merge through `.github/workflows/bot-merge.yml`. That
# workflow uses GitHub's git/commits REST API to create web-flow-signed
# copies of each PR commit on top of `main`, then updates
# `refs/heads/main` via the operator's identity (`agranado2k`,
# authenticated via the MERGE_BOT_TOKEN secret). The
# bypass_pull_request_allowances entry above permits the workflow's
# PATCH despite branch protection's PR requirement.

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
