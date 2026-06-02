# modules/r2 — Application R2 buckets for hosted report content.
#
# The `tf-state` bucket is NOT managed here — it's the bootstrap bucket
# created manually before Terraform exists (chicken-and-egg). See docs/infra.md.
#
# We create one bucket per environment. Per-PR isolation uses prefix conventions
# (`pr-<N>/` keys inside the staging or CI bucket), not separate buckets, so
# CI doesn't pay a provisioning round trip per PR.

terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.40"
    }
  }
}

resource "cloudflare_r2_bucket" "this" {
  for_each   = toset(var.bucket_names)
  account_id = var.account_id
  name       = each.value
  # The provider requires uppercase ("ENAM", "WEUR", …). Normalizing here
  # so callers can pass either case — Cloudflare's own docs are inconsistent
  # about which to use.
  location = upper(var.location)

  # R2 versioning isn't yet a first-class TF resource in cloudflare/cloudflare
  # v4. Enable it via the dashboard or via the API in a null_resource hook.
  # ADR-018 requires versioning ON for the tf-state bucket; ADR-001's stable-
  # slug semantics don't require versioning on the application buckets (we
  # version content via `report_versions` table + R2 keys), but having it on
  # protects against accidental deletes during incidents.
  #
  # TODO(phase-0b-followup): add `cloudflare_r2_bucket_lifecycle` / versioning
  # when the provider exposes them, or wrap with a null_resource that PUTs the
  # required headers via curl during apply.
}
