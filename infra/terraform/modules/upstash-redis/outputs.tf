output "endpoint" {
  value       = upstash_redis_database.this.endpoint
  description = "Redis endpoint hostname (hostname only, no scheme)."
}

output "port" {
  value       = upstash_redis_database.this.port
  description = "Redis port."
}

output "password" {
  value       = upstash_redis_database.this.password
  description = "Redis auth password — handle as secret."
  sensitive   = true
}

output "rest_url" {
  value       = "https://${upstash_redis_database.this.endpoint}"
  description = "Upstash REST URL (used by `@upstash/redis` client over HTTP from edge functions)."
}

output "rest_token" {
  value       = upstash_redis_database.this.rest_token
  description = "Upstash REST API token — handle as secret."
  sensitive   = true
}

output "read_only_rest_token" {
  value       = upstash_redis_database.this.read_only_rest_token
  description = "Read-only REST token. Use for the viewer's edge MW scan-status pre-check."
  sensitive   = true
}
