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
  region        = var.region
  tls           = true
  # Note: `multizone` was removed (deprecated by Upstash; auto-enabled on
  # paid plans). The `multizone` variable is kept as a no-op for callers
  # so the env compositions don't break; we may reuse it for a future
  # "tier" abstraction.
}
