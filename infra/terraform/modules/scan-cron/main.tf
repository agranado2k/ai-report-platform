terraform {
  required_providers {
    cloudflare = { source = "cloudflare/cloudflare", version = "~> 4.40" }
    null       = { source = "hashicorp/null", version = "~> 3.2" }
  }
}

# Register the account's workers.dev subdomain (CF error 10063). There is no
# native Terraform resource for this in the cloudflare provider (v4 or v5 — only
# the per-script `workers_script_subdomain` toggle, which itself needs the
# account subdomain to already exist), so we PUT it via the API. Idempotent: the
# `triggers` keep it to a single run unless the name changes; the token is passed
# via `environment` (never interpolated into the command) so it can't leak into
# plan/apply output. Mirrors the r2 module's documented null_resource pattern.
resource "null_resource" "workers_subdomain" {
  triggers = { subdomain = var.workers_subdomain }

  provisioner "local-exec" {
    interpreter = ["/bin/bash", "-c"]
    environment = {
      CF_API_TOKEN = var.cf_api_token
      ACCOUNT_ID   = var.account_id
      SUBDOMAIN    = var.workers_subdomain
    }
    command = <<-EOT
      set -euo pipefail
      resp=$(curl -fsS -X PUT \
        "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/subdomain" \
        -H "Authorization: Bearer $CF_API_TOKEN" \
        -H "Content-Type: application/json" \
        --data "{\"subdomain\":\"$SUBDOMAIN\"}")
      echo "$resp" | grep -q '"success":true' || { echo "workers.dev subdomain registration failed: $resp" >&2; exit 1; }
    EOT
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
  # The cron trigger can't be created until the account workers.dev subdomain
  # exists (CF error 10063).
  depends_on = [null_resource.workers_subdomain]
}
