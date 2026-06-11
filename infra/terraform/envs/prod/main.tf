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

# Shared secret between the Cloudflare scan-cron Worker and the app's
# /internal/scan-drain route (ADR-0045). Self-generated — no operator input.
resource "random_password" "scan_drain_secret" {
  length  = 48
  special = false
}

module "scan_cron" {
  source       = "../../modules/scan-cron"
  account_id   = var.cloudflare_account_id
  env          = "prod"
  drain_url    = "https://app.${local.apex}/internal/scan-drain"
  drain_secret = random_password.scan_drain_secret.result
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
    # The app's env contract (packages/env, ADR-0043) exposes the Clerk
    # publishable key to the browser, so it MUST carry the PUBLIC_ prefix that
    # @t3-oss/env-core's clientPrefix enforces. Provisioning it as the bare
    # CLERK_PUBLISHABLE_KEY left PUBLIC_CLERK_PUBLISHABLE_KEY undefined, so
    # defineEnv() threw on every deps() route (/upload, /r/$slug → 500).
    PUBLIC_CLERK_PUBLISHABLE_KEY = { value = module.clerk.publishable_key, target = ["production", "preview"], sensitive = false }
    CLERK_SECRET_KEY             = { value = module.clerk.secret_key, target = ["production", "preview"] }
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
  }
}

module "vercel_app" {
  source                = "../../modules/vercel-app"
  name                  = "arp-app-prod"
  team_id               = var.vercel_team_id
  github_repo           = local.repo
  root_directory        = "apps/app"
  domains               = ["app.${local.apex}"]
  environment_variables = local.shared_env
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
