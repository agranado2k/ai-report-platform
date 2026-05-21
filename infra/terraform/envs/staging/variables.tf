variable "cloudflare_api_token" {
  type      = string
  sensitive = true
}

variable "cloudflare_account_id" {
  type        = string
  description = "Cloudflare account id (for R2)."
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
  description = "Staging Clerk publishable key (pk_test_…)."
}

variable "clerk_secret_key" {
  type        = string
  description = "Staging Clerk secret key (sk_test_…)."
  sensitive   = true
}
