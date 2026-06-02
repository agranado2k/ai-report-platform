variable "name" {
  type        = string
  description = "Database name (visible in Upstash console)."
}

variable "region" {
  type        = string
  description = <<-EOT
    Primary region for the (global) database. Upstash deprecated
    regional databases in 2026 — every instance is now "global" with a
    primary region + 0+ read replicas. 'us-east-1' co-locates with
    Vercel iad1; 'eu-west-1' for Europe.
  EOT
  default     = "us-east-1"
}

variable "read_regions" {
  type        = list(string)
  description = <<-EOT
    Additional read-replica regions for the global database. Empty list
    (default) means single-region — same cost + latency profile as the
    old regional setup. For prod you may want ['eu-west-1', 'ap-south-1']
    or similar to reduce read latency for global users.
  EOT
  default     = []
}

variable "multizone" {
  type        = bool
  description = <<-EOT
    DEPRECATED no-op. Multi-zone replication is auto-enabled on paid
    plans by Upstash. Kept here so existing env compositions don't
    break; safe to delete in v1.1.
  EOT
  default     = false
}
