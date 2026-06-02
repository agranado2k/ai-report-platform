output "project_id" {
  value       = neon_project.this.id
  description = "Neon project id (used to provision per-PR ephemeral branches via the Neon API in CI)."
}

output "prod_connection_uri" {
  value       = neon_project.this.connection_uri
  description = "Production connection string (main branch). Includes credentials — handle as secret."
  sensitive   = true
}

output "prod_role_password" {
  value       = neon_role.main.password
  description = "Generated password for the prod role. Saved into Vercel env vars by the composition."
  sensitive   = true
}
