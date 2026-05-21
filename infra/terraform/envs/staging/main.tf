# envs/staging/main.tf — composes staging instances of vercel-app x2, r2,
# upstash-redis, and clerk-app. Reads shared outputs (Neon connection string,
# Cloudflare zone, GitHub repo full name) via terraform_remote_state.

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
  neon_uri = data.terraform_remote_state.shared.outputs.neon_staging_connection_uri
}

# 1) R2 buckets — staging + CI.
module "r2" {
  source       = "../../modules/r2"
  account_id   = var.cloudflare_account_id
  bucket_names = ["arp-reports-staging", "arp-reports-ci"]
  location     = "enam"
}

# 2) Upstash Redis — staging instance (no multi-zone).
module "upstash" {
  source    = "../../modules/upstash-redis"
  name      = "arp-staging"
  region    = "us-east-1"
  multizone = false
}

# 3) Clerk app — staging test instance (docs-only module; validates key prefix).
module "clerk" {
  source          = "../../modules/clerk-app"
  env             = "staging"
  publishable_key = var.clerk_publishable_key
  secret_key      = var.clerk_secret_key
}

# Shared env vars wired into both Vercel projects.
locals {
  shared_env = {
    NODE_ENV                          = { value = "production", target = ["production", "preview"], sensitive = false }
    DATABASE_URL                      = { value = local.neon_uri, target = ["production", "preview"] }
    CLERK_PUBLISHABLE_KEY             = { value = module.clerk.publishable_key, target = ["production", "preview"], sensitive = false }
    CLERK_SECRET_KEY                  = { value = module.clerk.secret_key, target = ["production", "preview"] }
    UPSTASH_REDIS_REST_URL            = { value = module.upstash.rest_url, target = ["production", "preview"], sensitive = false }
    UPSTASH_REDIS_REST_TOKEN          = { value = module.upstash.rest_token, target = ["production", "preview"] }
    UPSTASH_REDIS_READONLY_REST_TOKEN = { value = module.upstash.read_only_rest_token, target = ["production", "preview"] }
    R2_ACCOUNT_ID                     = { value = var.cloudflare_account_id, target = ["production", "preview"], sensitive = false }
    R2_BUCKET                         = { value = "arp-reports-staging", target = ["production", "preview"], sensitive = false }
    R2_ENDPOINT                       = { value = module.r2.endpoint, target = ["production", "preview"], sensitive = false }
    APP_ORIGIN                        = { value = "https://staging.app.${local.apex}", target = ["production", "preview"], sensitive = false }
    VIEW_ORIGIN                       = { value = "https://staging.view.${local.apex}", target = ["production", "preview"], sensitive = false }
  }
}

# 4) Vercel app (dashboard).
module "vercel_app" {
  source                = "../../modules/vercel-app"
  name                  = "arp-app-staging"
  team_id               = var.vercel_team_id
  github_repo           = local.repo
  root_directory        = "apps/app"
  domains               = ["staging.app.${local.apex}"]
  environment_variables = local.shared_env
}

# 5) Vercel view (viewer).
module "vercel_view" {
  source                = "../../modules/vercel-app"
  name                  = "arp-view-staging"
  team_id               = var.vercel_team_id
  github_repo           = local.repo
  root_directory        = "apps/view"
  domains               = ["staging.view.${local.apex}"]
  environment_variables = local.shared_env
}
