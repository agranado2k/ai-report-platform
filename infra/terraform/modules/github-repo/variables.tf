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
    CI job names required to pass before a PR can merge. Each name must
    match an existing workflow job name EXACTLY, otherwise the branch
    becomes unmergeable (the rule waits for checks that never arrive).
    Default is an empty list — Phase 0c will populate it as ci.yml /
    cd.yml workflows come online and prove they actually run.
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
