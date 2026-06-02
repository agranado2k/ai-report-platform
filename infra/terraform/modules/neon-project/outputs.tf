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
  # neon_branch doesn't expose a connection URI directly. We build it from:
  #   - neon_role.main.name + .password  (inherited from main, since Neon
  #     copies the parent branch's roles into the forked branch)
  #   - neon_endpoint.staging.host       (the staging compute endpoint we
  #     explicitly created for read/write access to the staging branch)
  #   - neon_database.main.name          (also inherited; same logical db
  #     name on both branches; the branch isolates the data)
  value       = "postgresql://${neon_role.main.name}:${neon_role.main.password}@${neon_endpoint.staging.host}/${neon_database.main.name}?sslmode=require"
  description = "Staging connection string. Includes credentials — handle as secret. Credentials are inherited from the main branch (see main.tf comment); rotating main's password breaks staging until next fork."
  sensitive   = true
}

output "prod_role_password" {
  value       = neon_role.main.password
  description = "Generated password for the prod role. Saved into Vercel env vars by the composition."
  sensitive   = true
}
