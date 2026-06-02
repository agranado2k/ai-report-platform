# modules/upstash-redis — One Upstash Redis database per call.
#
# We use Upstash for rate-limit counters (per IP, per key, per org) and the
# small edge-KV-style cache used by the viewer to pre-check scan_status
# before invoking the loader. Rate-limit keys are prefixed by env
# (`prod:`, `staging:`, `pr-<N>:`) in application code, so one Redis per env
# is enough — no per-PR Redis provisioning.

terraform {
  required_providers {
    upstash = {
      source  = "upstash/upstash"
      version = "~> 1.5"
    }
  }
}

resource "upstash_redis_database" "this" {
  database_name = var.name
  # Upstash deprecated regional databases. All new Redis instances are
  # "global" — backed by a primary region and 0+ read replicas. We pin the
  # primary to the var.region value (callers pass e.g. "us-east-1"); read
  # replicas are configurable via var.read_regions but default to empty
  # (single-region global, which behaves like the old regional setup for
  # cost + latency).
  primary_region = var.region
  read_regions   = var.read_regions
  tls            = true
  # `multizone` and the old `region` are gone from the resource; the
  # corresponding variables are kept as no-ops below so existing env
  # compositions don't break.
}
