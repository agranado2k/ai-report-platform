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

  # `region` here is a mode switch in the provider, NOT a geographic
  # region. Upstash retired truly-regional databases — set this to
  # "global" and `primary_region` / `read_regions` carry the actual
  # geographic placement.
  region         = "global"
  primary_region = var.region       # callers pass e.g. "us-east-1"
  read_regions   = var.read_regions # empty list = no replicas (cheapest)

  tls = true
  # `multizone` is gone from the resource (auto-enabled on paid plans by
  # Upstash). The variable is kept as a no-op below so env compositions
  # don't break.
}
