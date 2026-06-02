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
  description = "Point-in-time-recovery window in seconds. Free tier: 24h (86400). Paid: up to 30d."
  default     = 86400
}
