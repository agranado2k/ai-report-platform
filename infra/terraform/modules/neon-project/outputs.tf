output "project_id" {
  value       = neon_project.this.id
  description = "Neon project id (used to provision per-PR ephemeral branches via the Neon API in CI)."
}

output "prod_connection_uri" {
  value       = neon_project.this.connection_uri
  description = "Production connection string (main branch). Includes credentials — handle as secret."
  sensitive   = true
}

output "staging_connection_uri" {
  # neon_branch doesn't expose a connection URI directly (branches don't
  # have an endpoint unless you create one). We assemble the URI from the
  # role/endpoint/database resources we provisioned for staging.
  value       = "postgresql://${neon_role.staging.name}:${neon_role.staging.password}@${neon_endpoint.staging.host}/${neon_database.staging.name}?sslmode=require"
  description = "Staging connection string. Includes credentials — handle as secret."
  sensitive   = true
}

output "prod_role_password" {
  value       = neon_role.main.password
  description = "Generated password for the prod role. Saved into Vercel env vars by the composition."
  sensitive   = true
}

output "staging_role_password" {
  value       = neon_role.staging.password
  description = "Generated password for the staging role."
  sensitive   = true
}
