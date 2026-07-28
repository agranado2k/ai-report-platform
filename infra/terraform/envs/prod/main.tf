# envs/prod/main.tf — production composition. Mirrors staging structurally,
# differs in: multi-zone Redis, prod Clerk live keys, single prod R2 bucket,
# prod connection URI from Neon main branch.

data "terraform_remote_state" "shared" {
  backend = "s3"
  config = {
    bucket                      = "tf-state"
    key                         = "shared.tfstate"
    region                      = "auto"
    endpoints                   = { s3 = "https://${var.cloudflare_account_id}.r2.cloudflarestorage.com" }
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    use_path_style              = true
  }
}

locals {
  apex     = data.terraform_remote_state.shared.outputs.apex_domain
  repo     = data.terraform_remote_state.shared.outputs.github_repo_full_name
  neon_uri = data.terraform_remote_state.shared.outputs.neon_prod_connection_uri
}

module "r2" {
  source       = "../../modules/r2"
  account_id   = var.cloudflare_account_id
  bucket_names = ["arp-reports-prod"]
  location     = "enam"
}

module "upstash" {
  source    = "../../modules/upstash-redis"
  name      = "arp-prod"
  region    = "us-east-1"
  multizone = true # prod gets multi-zone for HA
}

module "clerk" {
  source          = "../../modules/clerk-app"
  env             = "prod"
  publishable_key = var.clerk_publishable_key
  secret_key      = var.clerk_secret_key
}

# Staging/test Clerk instance — its keys are wired to Vercel `preview` deploys
# only (ADR-0048), so PR previews never authenticate against the prod instance.
module "clerk_staging" {
  source          = "../../modules/clerk-app"
  env             = "staging"
  publishable_key = var.clerk_publishable_key_staging
  secret_key      = var.clerk_secret_key_staging
}

# Shared secret between the Cloudflare scan-cron Worker and the app's
# /internal/scan-drain route (ADR-0045). Self-generated — no operator input.
resource "random_password" "scan_drain_secret" {
  length  = 48
  special = false
}

# Shared HMAC secret for the app↔view access token (ADR-0056). Self-generated, never
# operator input. The SAME value lands on both the app (mints) and view (verifies)
# projects via shared_env, so the credential-free viewer can verify what the app signs.
resource "random_password" "view_access_token_secret" {
  length  = 48
  special = false
  keepers = {
    # Rotate THROUGH the pipeline (ADR-017/018 — terraform runs via CI only,
    # never a manual `tf.sh apply`). Changing this value forces `apply-prod` to
    # regenerate the password on the next merge; the new value propagates to
    # VIEW_ACCESS_TOKEN_SECRET on BOTH arp-app-prod + arp-view-prod together
    # (same `.result`), so the two origins can never land mismatched.
    #
    # This initial keeper reconciles the drift from the 2026-06 P0 hotfix, where
    # the secret was set out-of-band via the Vercel API — a pipeline-owned value
    # restores IaC as the single source of truth. Rotation invalidates in-flight
    # edit/unlock tokens (users just re-open; the 8h session cap bounds it).
    # Bump the date suffix to force a future rotation.
    rotation = "2026-07-13-p0-reconcile"
  }
}

# Server-side HMAC pepper for `arp_` API keys (ADR-0008). Self-generated, never
# operator input. Distinct per environment so a preview-minted `arp_test_` key
# can't verify against production even while previews share the prod DB (see the
# data-isolation follow-up below): the stored HMAC is keyed by a different pepper.
resource "random_password" "api_key_pepper" {
  length  = 64
  special = false
}

resource "random_password" "api_key_pepper_preview" {
  length  = 64
  special = false
}

module "scan_cron" {
  source            = "../../modules/scan-cron"
  account_id        = var.cloudflare_account_id
  env               = "prod"
  drain_url         = "https://app.${local.apex}/internal/scan-drain"
  drain_secret      = random_password.scan_drain_secret.result
  cf_api_token      = var.cloudflare_api_token
  workers_subdomain = var.workers_subdomain
}

locals {
  shared_env = {
    # Codified here so every preview branch gets it
    # automatically. Without this var, Vercel's wrapper ignores the
    # Corepack-prepared pnpm and falls back to a built-in that hits the
    # Node 24 / pnpm URL bug (`ERR_INVALID_THIS: Value of "this" must be
    # of type URLSearchParams`). Apply to all build environments.
    ENABLE_EXPERIMENTAL_COREPACK      = { value = "1", target = ["production", "preview", "development"], sensitive = false }
    NODE_ENV                          = { value = "production", target = ["production"], sensitive = false }
    UPSTASH_REDIS_REST_URL            = { value = module.upstash.rest_url, target = ["production"], sensitive = false }
    UPSTASH_REDIS_REST_TOKEN          = { value = module.upstash.rest_token, target = ["production"] }
    UPSTASH_REDIS_READONLY_REST_TOKEN = { value = module.upstash.read_only_rest_token, target = ["production"] }
    APP_ORIGIN                        = { value = "https://app.${local.apex}", target = ["production"], sensitive = false }
    VIEW_ORIGIN                       = { value = "https://view.${local.apex}", target = ["production"], sensitive = false }

    # ── Runtime data plane — also on `preview` ───────────────────────────────
    # PR previews need these to serve the upload→view flow.
    #
    # FOLLOW-UP (before the first real user): with no persistent staging
    # (2026-06-02 diary), previews currently share the prod Neon DB + R2 bucket
    # — acceptable pre-launch (no real data). Isolate previews then: per-PR Neon
    # branch (reuse the migration-check pattern) + an `pr-<N>/` R2 key prefix,
    # and drop `preview` from these targets. (claude-review L-1 on PR #26.)
    #
    # R2_ACCESS_KEY_ID/SECRET are the new app-scoped S3 token for
    # arp-reports-prod (var.r2_*). Both omit `sensitive` → masked in Vercel
    # (module default), matching their sensitive=true TF vars.
    DATABASE_URL = { value = local.neon_uri, target = ["production", "preview"] }
    # Clerk keys are split by Vercel target (ADR-0048): production deploys use
    # the live Clerk instance; preview deploys use the staging/test instance, so
    # a PR preview can never authenticate against the prod user pool or — once
    # the JIT-provisioning slice lands — mint real production Orgs. The app reads
    # the same names (PUBLIC_CLERK_PUBLISHABLE_KEY / CLERK_SECRET_KEY) regardless
    # of target; only the value differs. The production entries keep their env-var
    # map keys so existing Vercel resources update in place; the preview entries
    # need distinct map keys + an explicit `key` (vercel-app falls back to the
    # map key otherwise). The app's env contract (packages/env, ADR-0043) exposes
    # the publishable key to the browser, hence the PUBLIC_ prefix + sensitive=false.
    PUBLIC_CLERK_PUBLISHABLE_KEY = { value = module.clerk.publishable_key, target = ["production"], sensitive = false }
    CLERK_SECRET_KEY             = { value = module.clerk.secret_key, target = ["production"] }
    clerk_pk_preview             = { key = "PUBLIC_CLERK_PUBLISHABLE_KEY", value = module.clerk_staging.publishable_key, target = ["preview"], sensitive = false }
    clerk_sk_preview             = { key = "CLERK_SECRET_KEY", value = module.clerk_staging.secret_key, target = ["preview"] }
    R2_ACCOUNT_ID                = { value = var.cloudflare_account_id, target = ["production", "preview"], sensitive = false }
    R2_BUCKET                    = { value = "arp-reports-prod", target = ["production", "preview"], sensitive = false }
    # No R2_ENDPOINT: the app derives the S3 endpoint inline from R2_ACCOUNT_ID
    # (container.server.ts) and it's not in the env contract (packages/env), so
    # provisioning it here was dead config. (claude-review pass-4 on PR #29.)
    R2_ACCESS_KEY_ID     = { value = var.r2_access_key_id, target = ["production", "preview"] }
    R2_SECRET_ACCESS_KEY = { value = var.r2_secret_access_key, target = ["production", "preview"] }

    # Async scan drain (ADR-0045). The bearer secret the Cloudflare scan-cron
    # Worker presents to POST /internal/scan-drain. On `preview` too, so the e2e
    # can drive the drain deterministically (CF cron only targets prod).
    SCAN_DRAIN_SECRET = { value = random_password.scan_drain_secret.result, target = ["production", "preview"] }

    # Shared access-token secret for private-report gating (ADR-0056). The same value
    # on both app + view (this is shared_env) so the app's mint verifies at the viewer.
    # On preview too, so PR previews can exercise the password-mode unlock flow.
    VIEW_ACCESS_TOKEN_SECRET = { value = random_password.view_access_token_secret.result, target = ["production", "preview"] }

    # API-key auth (ADR-0008). HMAC pepper + environment label, split by target
    # like the Clerk keys above: production mints/verifies `arp_live_…` keys with
    # the live pepper; previews use a separate pepper + `arp_test_…` label, so a
    # preview key never verifies in prod. The app fails CLOSED if the pepper is
    # absent (packages/env optional + ApiKeyService), so this is the only thing
    # standing between "API keys disabled" and "enabled" in deployed envs.
    API_KEY_PEPPER         = { value = random_password.api_key_pepper.result, target = ["production"] }
    api_key_pepper_preview = { key = "API_KEY_PEPPER", value = random_password.api_key_pepper_preview.result, target = ["preview"] }
    API_KEY_ENV            = { value = "live", target = ["production"], sensitive = false }
    api_key_env_preview    = { key = "API_KEY_ENV", value = "test", target = ["preview"], sensitive = false }
  }
}

module "vercel_app" {
  source         = "../../modules/vercel-app"
  name           = "arp-app-prod"
  team_id        = var.vercel_team_id
  github_repo    = local.repo
  root_directory = "apps/app"
  domains        = ["app.${local.apex}"]
  # The Clerk user.deleted webhook secret (ADR-0054) is scoped to the APP project
  # only (the webhook route lives in apps/app) — kept out of the view project's env.
  # production-only: the Clerk webhook endpoint is registered for app.<apex>. Omitted
  # entirely until the secret is provided (TF_VAR_clerk_webhook_signing_secret), so the
  # route stays fail-closed (503) rather than the apply breaking on an unset var.
  environment_variables = merge(
    local.shared_env,
    var.clerk_webhook_signing_secret != "" ? {
      CLERK_WEBHOOK_SIGNING_SECRET = { value = var.clerk_webhook_signing_secret, target = ["production"] }
    } : {},
    # Transactional email via Resend (ADR-0057) — the allowlist magic link. App project
    # only (the unlock route sends). EMAIL_FROM is on the apex domain verified with Resend
    # (modules/resend-domain, DKIM/SPF already provisioned in the shared zone). Production
    # + preview so a PR preview can exercise the flow; omitted until the key is provided
    # (fail-open — no EmailSender wired). A `for … if` comprehension (not a `? {} : {}`
    # ternary) with both entries the same shape keeps the conditional type consistent.
    {
      for k, v in {
        RESEND_API_KEY = { value = var.resend_api_key, target = ["production", "preview"], sensitive = true }
        EMAIL_FROM     = { value = "noreply@${local.apex}", target = ["production", "preview"], sensitive = false }
      } : k => v if var.resend_api_key != ""
    },
    # OpenTelemetry → Grafana Cloud (ADR-0055). The OTel SDK reads these standard
    # OTEL_* names directly. On production + preview so PR previews also emit; omitted
    # until configured (fail-open — no endpoint → initTelemetry is a no-op). A map
    # comprehension (not a `? {} : {}` ternary) keeps the type consistent when empty.
    {
      for k, v in {
        OTEL_EXPORTER_OTLP_ENDPOINT = { value = var.grafana_otlp_endpoint, target = ["production", "preview"], sensitive = false }
        OTEL_EXPORTER_OTLP_HEADERS  = { value = var.grafana_otlp_headers, target = ["production", "preview"], sensitive = true }
      } : k => v if var.grafana_otlp_endpoint != ""
    },
  )
}

module "vercel_view" {
  source                = "../../modules/vercel-app"
  name                  = "arp-view-prod"
  team_id               = var.vercel_team_id
  github_repo           = local.repo
  root_directory        = "apps/view"
  domains               = ["view.${local.apex}"]
  environment_variables = local.shared_env
}

# The MCP server (ADR-0051) — a thin Express HTTP client over /api/v1. No
# framework preset (`framework = null`), so Vercel's zero-config builds the
# `apps/mcp/api/` serverless function; vercel.json rewrites every path to it.
# Callers present their own `arp_` API key which the server forwards (ADR-003).
# APP_ORIGIN points at the prod API on both targets (previews share prod data,
# pre-launch). The Clerk keys (ADR-0051 PR 4) enable the OAuth path: the MCP
# verifies inbound OAuth tokens + mints a short-lived session token to call
# /api/v1 — split by target like the app (prod = live instance, preview = dev),
# so OAuth resolves against the same Clerk instance /api/v1 trusts. This is the
# MCP's only secret; without it the OAuth path stays off + only `arp_` works.
locals {
  mcp_env = {
    ENABLE_EXPERIMENTAL_COREPACK = { value = "1", target = ["production", "preview", "development"], sensitive = false }
    APP_ORIGIN                   = { value = "https://app.${local.apex}", target = ["production", "preview"], sensitive = false }
    # Canonical OAuth resource identifier for the MCP (fixed, not the Host header).
    # Production only; previews have no stable origin and fall back to Host.
    MCP_ORIGIN                   = { value = "https://mcp.${local.apex}", target = ["production"], sensitive = false }
    PUBLIC_CLERK_PUBLISHABLE_KEY = { value = module.clerk.publishable_key, target = ["production"], sensitive = false }
    CLERK_SECRET_KEY             = { value = module.clerk.secret_key, target = ["production"] }
    mcp_clerk_pk_preview         = { key = "PUBLIC_CLERK_PUBLISHABLE_KEY", value = module.clerk_staging.publishable_key, target = ["preview"], sensitive = false }
    mcp_clerk_sk_preview         = { key = "CLERK_SECRET_KEY", value = module.clerk_staging.secret_key, target = ["preview"] }
  }
}

module "vercel_mcp" {
  source                = "../../modules/vercel-app"
  name                  = "arp-mcp-prod"
  team_id               = var.vercel_team_id
  framework             = null
  github_repo           = local.repo
  root_directory        = "apps/mcp"
  domains               = ["mcp.${local.apex}"]
  environment_variables = local.mcp_env
}
