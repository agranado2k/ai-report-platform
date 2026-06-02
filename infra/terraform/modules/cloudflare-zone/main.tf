# modules/cloudflare-zone — DNS + zone settings for the apex domain.
#
# Assumes the zone ALREADY EXISTS in the Cloudflare account (you registered
# or transferred the domain). We use a data source to look it up by name
# rather than creating it — domain registration is a billing/identity action
# that we don't want in Terraform's blast radius.
#
# DNS records: managed here. Production records (app.<domain>, view.<domain>)
# come from variable input; staging records (app.staging.<domain>, etc.) too.
# Resend DKIM/SPF records are inputs from the resend-domain module's outputs.

terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.40"
    }
  }
}

data "cloudflare_zone" "this" {
  name = var.domain
}

resource "cloudflare_record" "this" {
  for_each = { for r in var.records : "${r.type}-${r.name}" => r }

  zone_id = data.cloudflare_zone.this.id
  name    = each.value.name
  type    = each.value.type
  # `content` replaces the deprecated `value` argument in cloudflare provider
  # v4.40+. Same wire-level behavior; just the argument name changed.
  content = each.value.value
  ttl     = lookup(each.value, "ttl", 1) # 1 = automatic
  proxied = lookup(each.value, "proxied", false)
  comment = lookup(each.value, "comment", null)
}

# Zone-level security settings baseline.
resource "cloudflare_zone_settings_override" "this" {
  zone_id = data.cloudflare_zone.this.id

  settings {
    always_use_https         = "on"
    automatic_https_rewrites = "on"
    min_tls_version          = "1.2"
    tls_1_3                  = "on"
    opportunistic_encryption = "on"
    ssl                      = "strict"
    security_level           = "medium"
    browser_check            = "on"
    challenge_ttl            = 1800
    # We send our own HSTS header from the apps; the CF-level one is a backup.
    security_header {
      enabled            = true
      include_subdomains = true
      max_age            = 63072000 # 2 years (preload-eligible)
      nosniff            = true
      preload            = true
    }
  }
}
