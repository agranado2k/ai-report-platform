variable "org_id" {
  type        = string
  description = <<-EOT
    Neon organization id (required when the API key is associated with an
    organization, which is the default for new accounts as of 2024). Find
    it: Neon console → Organization → Settings → Organization ID. Looks
    like `org-xxxxxxxxxxxxx`.
  EOT
}

variable "project_name" {
  type        = string
  description = "Neon project name (visible in Neon console)."
}

variable "region" {
  type        = string
  description = "Neon region id (e.g. 'aws-us-east-1'). Pick the region closest to Vercel's region for low DB latency."
  default     = "aws-us-east-1"
}

variable "pg_version" {
  type        = number
  description = "Postgres major version."
  default     = 16
}

variable "database_name" {
  type        = string
  description = "Logical database name. Same across branches; the branch isolates the data."
  default     = "ai_report_platform"
}

variable "role_name" {
  type        = string
  description = "Database role (user) name. Same across branches; the branch isolates credentials."
  default     = "app"
}

variable "max_compute_units" {
  type        = number
  description = "Maximum compute units per endpoint. 0.25 (free tier ceiling) to 8."
  default     = 1
}

variable "history_retention_seconds" {
  type        = number
  description = <<-EOT
    Point-in-time-recovery window in seconds.
    Neon Free plan max:  21,600  (6h)
    Neon Launch plan:    604,800 (7d)
    Neon Scale/Business: 2,592,000 (30d)
    Default is 6h so a fresh free-tier account doesn't hit the cap.
    Override with TF_VAR_neon_history_retention_seconds after upgrading.
  EOT
  default     = 21600
}
