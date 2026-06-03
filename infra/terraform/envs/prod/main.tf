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

locals {
  shared_env = {
    # Codified here so every preview branch gets it
    # automatically. Without this var, Vercel's wrapper ignores the
    # Corepack-prepared pnpm and falls back to a built-in that hits the
    # Node 24 / pnpm URL bug (`ERR_INVALID_THIS: Value of "this" must be
    # of type URLSearchParams`). Apply to all build environments.
    ENABLE_EXPERIMENTAL_COREPACK      = { value = "1", target = ["production", "preview", "development"], sensitive = false }
    NODE_ENV                          = { value = "production", target = ["production"], sensitive = false }
    DATABASE_URL                      = { value = local.neon_uri, target = ["production"] }
    CLERK_PUBLISHABLE_KEY             = { value = module.clerk.publishable_key, target = ["production"], sensitive = false }
    CLERK_SECRET_KEY                  = { value = module.clerk.secret_key, target = ["production"] }
    UPSTASH_REDIS_REST_URL            = { value = module.upstash.rest_url, target = ["production"], sensitive = false }
    UPSTASH_REDIS_REST_TOKEN          = { value = module.upstash.rest_token, target = ["production"] }
    UPSTASH_REDIS_READONLY_REST_TOKEN = { value = module.upstash.read_only_rest_token, target = ["production"] }
    R2_ACCOUNT_ID                     = { value = var.cloudflare_account_id, target = ["production"], sensitive = false }
    R2_BUCKET                         = { value = "arp-reports-prod", target = ["production"], sensitive = false }
    R2_ENDPOINT                       = { value = module.r2.endpoint, target = ["production"], sensitive = false }
    APP_ORIGIN                        = { value = "https://app.${local.apex}", target = ["production"], sensitive = false }
    VIEW_ORIGIN                       = { value = "https://view.${local.apex}", target = ["production"], sensitive = false }
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
