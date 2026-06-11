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

variable "schedules" {
  type        = list(string)
  default     = ["* * * * *"]
  description = "Cron expressions (UTC) for the drain. Default: every minute."
}
