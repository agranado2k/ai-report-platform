variable "name" {
  type        = string
  description = "Vercel project name. Will be visible in the dashboard URL."

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{0,99}$", var.name))
    error_message = "Project name must be lowercase alphanumeric with hyphens, starting with a letter or number."
  }
}

variable "team_id" {
  type        = string
  description = "Vercel team id (starts with 'team_')."
}

variable "framework" {
  type        = string
  description = "Vercel framework preset. We use 'remix' for both apps/app and apps/view."
  default     = "remix"
}

variable "github_repo" {
  type        = string
  description = "Owner/repo for the GitHub integration (e.g. 'agranado2k/ai-report-platform')."
}

variable "root_directory" {
  type        = string
  description = "Path within the monorepo where this app's package.json lives (e.g. 'apps/app')."
}

variable "region" {
  type        = string
  description = "Default Vercel region for serverless functions. 'iad1' = us-east, 'fra1' = europe."
  default     = "iad1"
}

variable "domains" {
  type        = list(string)
  description = "Custom domains attached to this project (e.g. ['app.example.com'])."
  default     = []
}

variable "environment_variables" {
  type = map(object({
    value     = string
    target    = list(string) # ["production"], ["preview"], or both
    sensitive = optional(bool, true)
  }))
  description = <<-EOT
    Env vars to set on the Vercel project. The KEYS are addressable (Terraform
    uses them as resource instance keys) — keep them non-secret. The VALUES are
    treated as sensitive at the resource level (the inner `sensitive` field
    defaults to true). Use `target` to scope to production vs preview.
  EOT
  default     = {}
  # NOTE: variable is NOT marked sensitive at the map level — if it were,
  # `for_each` in main.tf would refuse. Per-value sensitivity is on the inner
  # `sensitive` field, applied to the Vercel resource itself.
}
