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
  description = "CI job names required to pass before a PR can merge. Must match the job names in .github/workflows/ci.yml exactly."
  default = [
    "ci / biome",
    "ci / typecheck",
    "ci / branch-name",
    "ci / unit-tests",
    "ci / migration-check",
    "ci / e2e-tests",
    "ci / security-headers",
    "ci / bruno-contract",
    "ci / docs-trigger-matrix",
  ]
}

variable "codeowners_content" {
  type        = string
  description = "Raw text content of .github/CODEOWNERS."
}

variable "bot_email" {
  type        = string
  description = "Commit author email used when Terraform writes files into the repo (CODEOWNERS, etc.)."
  default     = "terraform@noreply.local"
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
