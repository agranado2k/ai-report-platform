# envs/shared/main.tf — single-instance resources composed from modules.
# Apply order: shared FIRST, then staging, then prod (the others read shared's
# outputs via terraform_remote_state).

# 1) Resend domain — produces DNS records the cloudflare-zone module materializes.
module "resend_domain" {
  source      = "../../modules/resend-domain"
  domain      = var.apex_domain
  dns_records = var.resend_dns_records
}

# 2) Cloudflare zone — DNS + zone settings. Merges Resend's verification
#    records with our own production app/view records. Per-PR previews use
#    Vercel-generated preview domains (`*.vercel.app`), no DNS needed.
locals {
  apex          = var.apex_domain
  vercel_target = "cname.vercel-dns.com" # constant — every Vercel custom domain CNAMEs here

  app_view_records = [
    { name = "app", type = "CNAME", value = local.vercel_target, proxied = false, comment = "production dashboard" },
    { name = "view", type = "CNAME", value = local.vercel_target, proxied = false, comment = "production viewer" },
  ]

  # Clerk production instance: Account Portal + Frontend API custom domains, plus
  # the email DKIM/return-path records. ALL DNS-only (proxied = false) — Clerk
  # terminates TLS at *.clerk.services and proxying breaks CNAME flattening +
  # cert issuance. Targets are Clerk-issued per instance; re-run Clerk "Verify"
  # after these propagate.
  clerk_records = [
    { name = "accounts", type = "CNAME", value = "accounts.clerk.services", proxied = false, comment = "Clerk Account Portal" },
    { name = "clerk", type = "CNAME", value = "frontend-api.clerk.services", proxied = false, comment = "Clerk Frontend API" },
    { name = "clk._domainkey", type = "CNAME", value = "dkim1.d6r9n5il5s3x.clerk.services", proxied = false, comment = "Clerk email DKIM 1" },
    { name = "clk2._domainkey", type = "CNAME", value = "dkim2.d6r9n5il5s3x.clerk.services", proxied = false, comment = "Clerk email DKIM 2" },
    { name = "clkmail", type = "CNAME", value = "mail.d6r9n5il5s3x.clerk.services", proxied = false, comment = "Clerk email return-path" },
  ]

  all_records = concat(local.app_view_records, local.clerk_records, module.resend_domain.dns_records)
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
