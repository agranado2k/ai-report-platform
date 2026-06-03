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
  }

  enforce_admins                  = true # owner cannot bypass (ADR-025)
  require_signed_commits          = true
  require_conversation_resolution = true
  required_linear_history         = true
  allows_force_pushes             = false
  allows_deletions                = false
}

# ADR-034: GitHub Merge Queue (resolves the rebase-merge + signed-commits
# conflict — see the 2026-06-03 diary entry).
#
# Background. With `require_signed_commits = true` and rebase-merge as
# the only allowed merge method, the GitHub UI's "Rebase and merge" button
# rewrites the committer date on each PR commit, invalidating the
# signatures. GitHub cannot re-sign on the operator's behalf (only they
# hold the private key), so branch protection rejects the resulting
# unsigned commits and the PR can't be merged.
#
# Resolution: GitHub Merge Queue. The queue rebases the PR onto current
# `main`, runs CI against the rebased state (a synthetic
# `gh-readonly-queue/main/pr-N-XXX` ref), and when checks pass, pushes
# the result to `main` using GitHub's web-flow signing key — which IS
# trusted by `require_signed_commits`. This preserves both:
#   * ADR-025 — signed commits on `main`
#   * ADR-033 revision — rebase-merge with every PR commit landing on
#     `main` verbatim
#
# Operator flow: "Merge when ready" in the PR UI → queue → green CI on
# rebased state → automatic push. No manual rebase, no per-key dance.
#
# Implemented as a Repository Ruleset (newer GitHub API) rather than
# extending `github_branch_protection` because the older branch-protection
# resource doesn't expose merge queue settings. The two coexist: branch
# protection still enforces signed commits / linear history / no force
# push; the ruleset adds the merge queue behavior on top.
resource "github_repository_ruleset" "merge_queue" {
  name        = "main-merge-queue"
  repository  = github_repository.this.name
  target      = "branch"
  enforcement = "active"

  conditions {
    ref_name {
      include = ["~DEFAULT_BRANCH"]
      exclude = []
    }
  }

  rules {
    merge_queue {
      check_response_timeout_minutes    = 60
      grouping_strategy                 = "ALLGREEN"
      merge_method                      = "REBASE"
      min_entries_to_merge              = 1
      max_entries_to_merge              = 5
      max_entries_to_build              = 5
      min_entries_to_merge_wait_minutes = 5
    }
  }
}

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
