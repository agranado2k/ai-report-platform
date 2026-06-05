variable "cloudflare_api_token" {
  type      = string
  sensitive = true
}

variable "cloudflare_account_id" {
  type = string
}

# R2 S3 credentials for the application bucket (arp-reports-prod), Object Read &
# Write. Created as an R2 API token in the Cloudflare dashboard (the same
# bootstrap-PAT exception ADR-017 allows for the tf-state token); the access-key
# id is not itself a secret but is marked sensitive to keep it out of plan logs.
variable "r2_access_key_id" {
  type      = string
  sensitive = true
}

variable "r2_secret_access_key" {
  type      = string
  sensitive = true
}

variable "vercel_api_token" {
  type      = string
  sensitive = true
}

variable "vercel_team_id" {
  type = string
}

variable "upstash_email" {
  type = string
}

variable "upstash_api_key" {
  type      = string
  sensitive = true
}

variable "clerk_publishable_key" {
  type        = string
  description = "Production Clerk publishable key (pk_live_…)."
}

variable "clerk_secret_key" {
  type        = string
  description = "Production Clerk secret key (sk_live_…)."
  sensitive   = true
}
