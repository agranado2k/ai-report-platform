variable "cloudflare_api_token" {
  type      = string
  sensitive = true
}

variable "cloudflare_account_id" {
  type = string
}

# The account's workers.dev subdomain (ADR-0045). Registered once via the API by
# the scan-cron module — no native TF resource exists. Cosmetic (the cron Worker
# never serves on it). Defaulted here so no CI var is needed; change it if the
# apply fails because the name is globally taken.
variable "workers_subdomain" {
  type    = string
  default = "arp-reports-prod"
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

# Clerk webhook signing secret (ADR-0054) for the prod `user.deleted` endpoint
# (app.<apex>/webhooks/clerk), from the Clerk dashboard → Webhooks (`whsec_…`).
# OPTIONAL (default ""): when empty the env var is not provisioned and the route
# stays fail-closed (503), so the apply never breaks on a not-yet-set secret. Set
# it via TF_VAR_clerk_webhook_signing_secret (.tfvars.local + the CI secret store).
variable "clerk_webhook_signing_secret" {
  type        = string
  description = "Clerk user.deleted webhook signing secret (whsec_…) — prod app project."
  sensitive   = true
  default     = ""
}

# Resend API key for transactional email (ADR-0057, the allowlist magic link). OPTIONAL
# (default ""): empty ⇒ RESEND_API_KEY/EMAIL_FROM are not provisioned and no EmailSender
# is wired (the send-link path stays inert). Set via TF_VAR_resend_api_key (CI secret).
variable "resend_api_key" {
  type        = string
  description = "Resend API key (re_…) for transactional email — prod app project."
  sensitive   = true
  default     = ""
}

# OpenTelemetry → Grafana Cloud (ADR-0055). endpoint is the OTLP gateway URL (not
# secret); headers carries the basic-auth (instanceID:token) so it IS secret. Both
# OPTIONAL (default "") — unset → no OTEL env provisioned → telemetry fail-open.
variable "grafana_otlp_endpoint" {
  type        = string
  description = "Grafana Cloud OTLP gateway URL → OTEL_EXPORTER_OTLP_ENDPOINT."
  default     = ""
}
variable "grafana_otlp_headers" {
  type        = string
  description = "OTLP auth header (Authorization=Basic …) → OTEL_EXPORTER_OTLP_HEADERS."
  sensitive   = true
  default     = ""
}

# Staging/test Clerk instance keys (ADR-0048). Provisioned onto Vercel `preview`
# deploys ONLY, so a PR preview authenticates against the test Clerk instance and
# can never mint real users/orgs in the production pool or touch live data.
variable "clerk_publishable_key_staging" {
  type        = string
  description = "Staging Clerk publishable key (pk_test_…) — preview deploys only."
}

variable "clerk_secret_key_staging" {
  type        = string
  description = "Staging Clerk secret key (sk_test_…) — preview deploys only."
  sensitive   = true
}
