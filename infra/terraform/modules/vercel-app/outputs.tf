output "project_id" {
  value       = vercel_project.this.id
  description = "Vercel project id (used by other modules that need to attach domains, env vars, etc.)"
}

output "project_name" {
  value       = vercel_project.this.name
  description = "Vercel project name as registered."
}

output "domains" {
  value       = [for d in vercel_project_domain.this : d.domain]
  description = "Custom domains attached to this project."
}
