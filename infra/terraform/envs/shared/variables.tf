# Single-instance resources: GitHub repo + Cloudflare zone + Neon project +
# Resend domain. Lives once; consumed by prod + staging via remote-state reads.

variable "apex_domain" {
  type        = string
  description = "Apex domain (e.g. 'example.com'). Must already exist in your Cloudflare account."
}

variable "operator_email" {
  type        = string
  description = "Email used for Cloudflare/Resend operator contact and CODEOWNERS commits."
}

variable "cloudflare_api_token" {
  type        = string
  description = "Cloudflare API token with Zone:DNS:Edit + Account:R2:Edit + Account:Workers:Edit."
  sensitive   = true
}

variable "github_token" {
  type        = string
  description = "GitHub fine-grained PAT scoped to the agranado2k account with repo Admin + Contents + Actions + Secrets."
  sensitive   = true
}

variable "neon_api_key" {
  type        = string
  description = "Neon API key (full-access)."
  sensitive   = true
}

variable "neon_org_id" {
  type        = string
  description = "Neon organization id. Required when creating projects under an org-scoped API key. Find it: Neon console → Organization → Settings → Organization ID."
}

variable "resend_dns_records" {
  type = list(object({
    name  = string
    type  = string
    value = string
  }))
  description = "DNS records from the Resend dashboard's domain-verification screen."
}

# Forwarded to the GitHub Actions secrets so CI/CD can reach every backend.
variable "anthropic_api_key" {
  type      = string
  sensitive = true
}

variable "gemini_api_key" {
  type      = string
  sensitive = true
}

variable "vercel_api_token" {
  type      = string
  sensitive = true
}

variable "upstash_email" {
  type = string
}

variable "upstash_api_key" {
  type      = string
  sensitive = true
}

variable "resend_api_key" {
  type      = string
  sensitive = true
}
