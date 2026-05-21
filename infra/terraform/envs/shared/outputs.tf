# Outputs consumed by envs/prod and envs/staging via terraform_remote_state.

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
  value = module.neon_project.project_id
}

output "neon_prod_connection_uri" {
  value     = module.neon_project.prod_connection_uri
  sensitive = true
}

output "neon_staging_connection_uri" {
  value     = module.neon_project.staging_connection_uri
  sensitive = true
}
