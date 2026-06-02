# envs/shared/main.tf — single-instance resources composed from modules.
# Apply order: shared FIRST, then staging, then prod (the others read shared's
# outputs via terraform_remote_state).

# 1) Resend domain — produces DNS records the cloudflare-zone module materializes.
module "resend_domain" {
  source      = "../../modules/resend-domain"
  domain      = var.apex_domain
  dns_records = var.resend_dns_records
}

# 2) Cloudflare zone — DNS + zone settings. Merges Resend's verification records
#    with our own app/view records for both prod and staging.
locals {
  apex          = var.apex_domain
  vercel_target = "cname.vercel-dns.com" # constant — every Vercel custom domain CNAMEs here

  app_view_records = [
    { name = "app", type = "CNAME", value = local.vercel_target, proxied = false, comment = "production dashboard" },
    { name = "view", type = "CNAME", value = local.vercel_target, proxied = false, comment = "production viewer" },
    { name = "staging.app", type = "CNAME", value = local.vercel_target, proxied = false, comment = "staging dashboard" },
    { name = "staging.view", type = "CNAME", value = local.vercel_target, proxied = false, comment = "staging viewer" },
  ]

  all_records = concat(local.app_view_records, module.resend_domain.dns_records)
}

module "cloudflare_zone" {
  source  = "../../modules/cloudflare-zone"
  domain  = var.apex_domain
  records = local.all_records
}

# 3) Neon project — one project, branches per env, managed in this state file.
module "neon_project" {
  source       = "../../modules/neon-project"
  project_name = "ai-report-platform"
  org_id       = var.neon_org_id
}

# 4) GitHub repo — the source-of-truth for the platform.
# CODEOWNERS is NOT managed here — see the comment in modules/github-repo/main.tf.
# The file lives at `.github/CODEOWNERS` in the repo root, edited via normal PRs.
module "github_repo" {
  source    = "../../modules/github-repo"
  repo_name = "ai-report-platform"

  actions_secrets = {
    # AI review (ADR-030)
    ANTHROPIC_API_KEY = var.anthropic_api_key
    GEMINI_API_KEY    = var.gemini_api_key

    # Vercel deploys
    VERCEL_TOKEN = var.vercel_api_token

    # Neon ephemeral-branch provisioning in CI
    NEON_API_KEY = var.neon_api_key

    # Terraform apply on CD
    CLOUDFLARE_API_TOKEN = var.cloudflare_api_token

    # Upstash management (rate-limit setup in CI/CD)
    UPSTASH_EMAIL   = var.upstash_email
    UPSTASH_API_KEY = var.upstash_api_key

    # Resend (email sending from app)
    RESEND_API_KEY = var.resend_api_key
  }

  actions_variables = {
    APEX_DOMAIN     = var.apex_domain
    NEON_PROJECT_ID = module.neon_project.project_id
  }
}
