# modules/scan-cron — a Cloudflare Cron Trigger Worker that pokes the app's
# /internal/scan-drain route on a schedule (ADR-0045). Free Workers plan; CF is
# already a vendor, so no new provider. The Worker carries no logic — it only
# triggers the drain, keeping the scan engine in the app's domain code.

variable "account_id" {
  type        = string
  description = "Cloudflare account id."
}

variable "env" {
  type        = string
  description = "Environment name, used in the Worker script name (e.g. prod)."
}

variable "drain_url" {
  type        = string
  description = "Absolute URL of the app's POST /internal/scan-drain route."
}

variable "drain_secret" {
  type        = string
  sensitive   = true
  description = "Shared bearer secret the Worker presents; matches the app's SCAN_DRAIN_SECRET."
}

variable "cf_api_token" {
  type        = string
  sensitive   = true
  description = <<-EOT
    Cloudflare API token (needs Workers Scripts: Edit) used to register the
    account workers.dev subdomain via the API. No native TF resource exists for
    this in v4 or v5 — only the per-script `workers_script_subdomain` toggle —
    so it's done with a null_resource + curl (the pattern the r2 module's
    versioning TODO already contemplates).
  EOT
}

variable "workers_subdomain" {
  type        = string
  description = <<-EOT
    Globally-unique workers.dev subdomain to register for the account, one-time
    (CF error 10063 blocks any Worker cron trigger until it exists). Cosmetic —
    our cron Worker never serves on it. If the apply fails "subdomain taken",
    pick another name.
  EOT
}

variable "schedules" {
  type        = list(string)
  default     = ["* * * * *"]
  description = "Cron expressions (UTC) for the drain. Default: every minute."
}
