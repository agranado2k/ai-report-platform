output "project_id" {
  value       = neon_project.this.id
  description = "Neon project id (used to provision per-PR ephemeral branches via the Neon API in CI)."
}

output "prod_connection_uri" {
  # Connection string for the app's dedicated database + role
  # (`ai_report_platform` owned by `app`) — NOT neon_project.connection_uri,
  # which points at Neon's auto-created default `neondb`/`neondb_owner`. The app
  # standardizes on the TF-declared db/role (least-privilege; see docs/diary.md).
  # `database_host` is the branch endpoint host (shared across the branch's dbs).
  value       = "postgresql://${neon_role.main.name}:${neon_role.main.password}@${neon_project.this.database_host}/${neon_database.main.name}?sslmode=require"
  description = "Production connection string for the app db (ai_report_platform/app). Includes credentials — handle as secret."
  sensitive   = true
}

output "prod_role_password" {
  value       = neon_role.main.password
  description = "Generated password for the prod role. Saved into Vercel env vars by the composition."
  sensitive   = true
}
