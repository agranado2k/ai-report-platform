variable "cloudflare_api_token" {
  type      = string
  sensitive = true
}

variable "cloudflare_account_id" {
  type = string
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
