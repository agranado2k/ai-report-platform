# Outputs consumed by envs/prod via terraform_remote_state.
# (envs/staging was removed when we adopted continuous deployment to prod —
# see the 2026-06-02 diary entry for the rationale.)

output "apex_domain" {
  value = var.apex_domain
}

output "cloudflare_zone_id" {
  value = module.cloudflare_zone.zone_id
}

output "github_repo_full_name" {
  value = module.github_repo.full_name
}

output "neon_project_id" {
  value       = module.neon_project.project_id
  description = "Per-PR ephemeral branches are created from this project id by CI via the Neon API."
}

output "neon_prod_connection_uri" {
  value     = module.neon_project.prod_connection_uri
  sensitive = true
}
