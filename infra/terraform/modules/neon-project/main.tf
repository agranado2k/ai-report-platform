# modules/neon-project — One Neon project, two branches (prod + staging),
# one database, one role per env.
#
# Per-PR ephemeral branches are created via the Neon API directly from
# GitHub Actions — NOT here. Terraform is too slow for ephemeral state and
# would race with concurrent PRs.
#
# This module produces connection strings as outputs. They get fed into the
# Vercel project env vars in the env composition.

terraform {
  required_providers {
    neon = {
      source  = "kislerdm/neon"
      version = "~> 0.6"
    }
  }
}

resource "neon_project" "this" {
  # `org_id` is required when the API key belongs to an organization (true for
  # all new Neon accounts since 2024). Find it: Neon console → Organization →
  # Settings → Organization ID. Pass via TF_VAR_neon_org_id.
  org_id = var.org_id

  name                      = var.project_name
  region_id                 = var.region
  pg_version                = var.pg_version
  history_retention_seconds = var.history_retention_seconds # PITR window

  # Default branch is 'main' — we use it as production. Staging is a child
  # branch, which means copy-on-write storage (cheap) and instant fork.
  # The default endpoint is auto-created on the default branch; its compute
  # bounds are set via `neon_endpoint.staging` below for staging and stay at
  # provider defaults for prod (which is fine for v1; tune in v1.1).

  # PROD DATA SAFETY: never let `terraform apply` destroy or REPLACE the prod
  # Neon project. A forced replacement already wiped the applied schema once
  # (2026-06: br-tiny-hall → br-wispy-flower — see docs/diary.md + migrate-db.yml).
  # With this guard, any plan that would destroy/recreate this resource ERRORS
  # at plan time instead of silently nuking prod. To intentionally allow it,
  # remove this block in a deliberate PR (the operator's explicit "yes").
  lifecycle {
    prevent_destroy = true
  }
}

resource "neon_database" "main" {
  project_id = neon_project.this.id
  branch_id  = neon_project.this.default_branch_id
  name       = var.database_name
  owner_name = neon_role.main.name

  # The schema + all report data live here — guard it like the project above.
  lifecycle {
    prevent_destroy = true
  }
}

resource "neon_role" "main" {
  project_id = neon_project.this.id
  branch_id  = neon_project.this.default_branch_id
  name       = var.role_name

  # Dropping/recreating the owning role cascades to its objects — guard it too.
  lifecycle {
    prevent_destroy = true
  }
}

# Note: there's no persistent `staging` branch here. The platform deploys
# continuously to prod (no persistent staging — see the 2026-06-02 diary entry);
# the `main` branch is production and
# per-PR ephemeral branches are created by CI on-demand via the Neon API,
# not Terraform. If a long-lived staging branch becomes useful later
# (e.g. for shared QA), add `neon_branch.staging` + `neon_endpoint.staging`
# back; the inherited-role pattern documented earlier still applies.
