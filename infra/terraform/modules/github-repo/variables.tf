variable "repo_name" {
  type        = string
  description = "Repository name (without owner). E.g. 'ai-report-platform'."
}

variable "description" {
  type        = string
  description = "GitHub repo description."
  default     = "SaaS platform for hosting LLM-generated HTML reports with stable share URLs."
}

variable "visibility" {
  type        = string
  description = "'public' or 'private'."
  default     = "public"

  validation {
    condition     = contains(["public", "private"], var.visibility)
    error_message = "visibility must be 'public' or 'private'."
  }
}

variable "required_status_checks" {
  type        = list(string)
  description = <<-EOT
    Check names required to pass before a PR can merge into `main`.

    Each string must match what GITHUB REPORTS, exactly — which is the job's
    `name:` (not its key), and for a job that calls a REUSABLE workflow, the
    composite "<calling job name> / <called job name>". Verify against a real
    check run before adding one:

      gh api repos/<owner>/<repo>/commits/<sha>/check-runs \
        -q '.check_runs[].name'

    A name that never arrives is NOT a no-op: the rule stays pending forever
    and `main` becomes unmergeable — including for the PR correcting the
    mistake, since `enforce_admins = true`. docs/ops.md carries the recovery
    procedure.

    Do not list a check whose workflow is PATH-FILTERED: it reports nothing on
    PRs that miss the filter, which is indistinguishable from "still running".

    Set in envs/shared (2026-08-06); the default stays empty so a fresh
    environment is never bricked by a list it has no workflows for.
  EOT
  default     = []
}

variable "actions_secrets" {
  type        = map(string)
  description = "GitHub Actions secrets (ANTHROPIC_API_KEY, GEMINI_API_KEY, VERCEL_TOKEN, NEON_API_KEY, etc.). Keys are addressable (resource instance keys); values are sensitive — Terraform's `plaintext_value` argument on github_actions_secret already encrypts at rest."
  default     = {}
  # Variable not marked sensitive at the map level; per-value sensitivity is
  # handled by the GitHub provider, which transmits + stores values encrypted.
}

variable "actions_variables" {
  type        = map(string)
  description = "GitHub Actions variables (non-sensitive config like VERCEL_PROJECT_ID_APP, R2_ENDPOINT)."
  default     = {}
}
