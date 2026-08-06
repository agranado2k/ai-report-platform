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
    { name = "mcp", type = "CNAME", value = local.vercel_target, proxied = false, comment = "production MCP server (ADR-0051)" },
  ]

  # Clerk production instance: Account Portal + Frontend API custom domains, plus
  # the email DKIM/return-path records. ALL DNS-only (proxied = false) — Clerk
  # terminates TLS at *.clerk.services and proxying breaks CNAME flattening +
  # cert issuance. Targets are Clerk-issued per instance; re-run Clerk "Verify"
  # after these propagate.
  clerk_records = [
    { name = "accounts", type = "CNAME", value = "accounts.clerk.services", proxied = false, comment = "Clerk Account Portal" },
    { name = "clerk", type = "CNAME", value = "frontend-api.clerk.services", proxied = false, comment = "Clerk Frontend API" },
    { name = "clk._domainkey", type = "CNAME", value = "dkim1.iqr5g5hmntgy.clerk.services", proxied = false, comment = "Clerk email DKIM 1" },
    { name = "clk2._domainkey", type = "CNAME", value = "dkim2.iqr5g5hmntgy.clerk.services", proxied = false, comment = "Clerk email DKIM 2" },
    { name = "clkmail", type = "CNAME", value = "mail.iqr5g5hmntgy.clerk.services", proxied = false, comment = "Clerk email return-path" },
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

  # CI checks that must PASS before `main` accepts a merge.
  #
  # This list was `[]` — the module's default — which meant branch protection
  # required "up to date with main" and nothing else. A genuinely red check
  # could not block a merge, and an infrastructure blip (there were two this
  # week: GitHub's own action-download service 503'ing out `claude-review` and
  # `Preview data isolation`) was indistinguishable from a real defect, because
  # neither had any effect on mergeability.
  #
  # EVERY STRING MUST MATCH WHAT GITHUB REPORTS, EXACTLY. A typo is not a no-op:
  # the rule waits forever for a check that never arrives, and `main` becomes
  # unmergeable — including for the PR that would fix the typo, since
  # `enforce_admins = true`. Each name below was read off a REAL check run
  # (`gh api repos/{owner}/{repo}/commits/{sha}/check-runs`) on an open PR
  # rather than inferred from the workflow files. See docs/ops.md for the
  # recovery procedure if one is ever renamed or retired.
  #
  # `Workflow / Job` composite names come from REUSABLE workflows: when
  # `preview-isolation.yml`'s `smoke` job (`name: Smoke the isolated preview`)
  # calls `e2e.yml` (whose job is `name: E2E smoke against preview`), GitHub
  # reports the pair joined by " / ". Neither half alone is a valid context.
  #
  # ONE SUBTLETY, observed on #248/#249 and worth not rediscovering: those same
  # jobs ALSO report under their BARE name ("Smoke the isolated preview",
  # "Security headers") with conclusion `skipped` — but only on the
  # `pull_request: closed` event, where `if: github.event.action != 'closed'`
  # skips the caller before it ever reaches the reusable workflow. On the
  # `opened`/`synchronize` runs that decide mergeability, only the composite
  # form appears. The composite is therefore the correct context, and requiring
  # the bare name would wait forever on any open PR.
  required_status_checks = [
    # ── The fast, hermetic gate ────────────────────────────────────────
    # `Unit tests` also runs `pnpm --filter "./packages/*" typecheck` and
    # `pnpm e2e:gen` (bddgen, which errors on any undefined BDD step), so it
    # is the typecheck and step-definition gate too.
    "Unit tests",
    "Editor browser tests",
    "Biome",
    "Docs conformance",
    "Lint PR commits",
    # ── The infrastructure-first gate (ADR-019) ────────────────────────
    # `Isolate preview data plane` provisions the per-PR Neon branch and waits
    # for the redeploy to reach READY; both checks below depend on it, so a
    # failure there means neither ran at all.
    "Isolate preview data plane",
    "Smoke the isolated preview / E2E smoke against preview",
    "Security headers / Security headers (viewer preview)",
  ]

  # DELIBERATELY NOT REQUIRED, and each for a different reason:
  #
  #   - `Migration check`, and every `Terraform` job (`plan-shared`,
  #     `plan-prod`, `fmt-and-validate`) — PATH-FILTERED (`packages/db/**`,
  #     `infra/terraform/**`). A workflow that does not trigger reports no
  #     check at all, so requiring these would leave every PR that touches
  #     neither path permanently pending. They still gate the PRs they run on,
  #     by being red. Making them required would first need a companion job
  #     that reports success when the paths are untouched.
  #   - `claude-review` and `review` (Gemini) — ADR-030 makes AI review
  #     ADVISORY. It does not gate merge, and both failed today on GitHub's own
  #     outage, which is exactly the "a blip blocks the repo" failure this
  #     change is otherwise trying to end.
  #   - `Tear down preview data plane` — only runs on `pull_request: closed`.
  #   - `assign` (auto-assign-pr-author) — housekeeping, not a gate.
  #   - The `Vercel – arp-*-prod` commit statuses — third-party, and already
  #     covered: a failed build makes `Isolate preview data plane` (which
  #     redeploys and polls for READY) fail too.

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
