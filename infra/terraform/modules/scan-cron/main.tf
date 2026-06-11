terraform {
  required_providers {
    cloudflare = { source = "cloudflare/cloudflare", version = "~> 4.40" }
  }
}

resource "cloudflare_workers_script" "scan_drain" {
  account_id         = var.account_id
  name               = "arp-scan-drain-${var.env}"
  content            = file("${path.module}/worker.js")
  module             = true
  compatibility_date = "2024-09-23"

  plain_text_binding {
    name = "DRAIN_URL"
    text = var.drain_url
  }

  secret_text_binding {
    name = "DRAIN_SECRET"
    text = var.drain_secret
  }
}

resource "cloudflare_workers_cron_trigger" "scan_drain" {
  account_id  = var.account_id
  script_name = cloudflare_workers_script.scan_drain.name
  schedules   = var.schedules
}
