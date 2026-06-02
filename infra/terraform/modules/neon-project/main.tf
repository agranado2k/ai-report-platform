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
}

resource "neon_database" "main" {
  project_id = neon_project.this.id
  branch_id  = neon_project.this.default_branch_id
  name       = var.database_name
  owner_name = neon_role.main.name
}

resource "neon_role" "main" {
  project_id = neon_project.this.id
  branch_id  = neon_project.this.default_branch_id
  name       = var.role_name
}

# Staging branch (forks from main; copy-on-write storage).
resource "neon_branch" "staging" {
  project_id = neon_project.this.id
  parent_id  = neon_project.this.default_branch_id
  name       = "staging"
}

resource "neon_database" "staging" {
  project_id = neon_project.this.id
  branch_id  = neon_branch.staging.id
  name       = var.database_name
  owner_name = neon_role.staging.name
}

resource "neon_role" "staging" {
  project_id = neon_project.this.id
  branch_id  = neon_branch.staging.id
  name       = var.role_name
}

resource "neon_endpoint" "staging" {
  project_id               = neon_project.this.id
  branch_id                = neon_branch.staging.id
  type                     = "read_write"
  autoscaling_limit_min_cu = 0.25
  autoscaling_limit_max_cu = var.max_compute_units
}
