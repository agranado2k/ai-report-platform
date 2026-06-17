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
  root_directory = var.root_directory
  # Public previews — we gate access via our own ACL (the viewer's, ADR-0038),
  # not Vercel's SSO. `null` does NOT disable Vercel Authentication (it leaves
  # the team-level default = Standard Protection ON, which 401s previews for
  # anonymous + CI automation); `deployment_type = "none"` is required to
  # actually make deployments public. The bare `null` is why the BDD smoke got
  # 401 against the preview.
  vercel_authentication      = { deployment_type = "none" }
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
  # Vercel env-var name defaults to the map key; an explicit `key` lets two
  # entries emit the same name on different targets (see variables.tf).
  key       = coalesce(each.value.key, each.key)
  value     = each.value.value
  target    = each.value.target # ["production"], ["preview"], or ["production", "preview"]
  sensitive = lookup(each.value, "sensitive", true)
}

resource "vercel_project_domain" "this" {
  for_each   = toset(var.domains)
  project_id = vercel_project.this.id
  team_id    = var.team_id
  domain     = each.value
}
