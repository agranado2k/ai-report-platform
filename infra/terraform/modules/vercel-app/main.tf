# modules/vercel-app — Provision a single Vercel project for one Remix app.
#
# Used twice per env: once for `apps/app` and once for `apps/view`. Each call
# produces a project with the right name, framework, custom domain, env vars,
# and Git integration. Preview deploys come for free via Vercel's GitHub
# integration once `git_repository` is set.

terraform {
  required_providers {
    vercel = {
      source  = "vercel/vercel"
      version = "~> 2.0"
    }
  }
}

resource "vercel_project" "this" {
  name      = var.name
  framework = var.framework
  team_id   = var.team_id

  # Git integration produces preview deploys on every PR automatically.
  git_repository = {
    type              = "github"
    repo              = var.github_repo
    production_branch = "main"
  }

  # Where the Remix build outputs come from in a Turborepo. Vercel auto-detects
  # for simple repos but a monorepo benefits from the explicit hint.
  root_directory             = var.root_directory
  vercel_authentication      = null # public previews; we gate via our own ACL
  serverless_function_region = var.region
}

resource "vercel_project_environment_variable" "this" {
  # `for_each` keys can't be sensitive (Terraform refuses to print sensitive
  # values as resource addresses). The KEYS here — env var names like
  # DATABASE_URL — aren't secret; only the VALUES are. `nonsensitive()` tells
  # Terraform we've audited that this map's keys are safe to address.
  for_each   = nonsensitive(var.environment_variables)
  project_id = vercel_project.this.id
  team_id    = var.team_id
  key        = each.key
  value      = each.value.value
  target     = each.value.target # ["production"], ["preview"], or ["production", "preview"]
  sensitive  = lookup(each.value, "sensitive", true)
}

resource "vercel_project_domain" "this" {
  for_each   = toset(var.domains)
  project_id = vercel_project.this.id
  team_id    = var.team_id
  domain     = each.value
}
