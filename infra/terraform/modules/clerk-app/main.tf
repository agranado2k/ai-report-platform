# modules/clerk-app — Documentation-only module.
#
# Clerk's Terraform provider (clerk/clerk) is currently limited: it can
# manage JWT templates and a few instance settings, but the core
# application configuration (Organizations enabled, MFA enforcement,
# OAuth providers, allowed origins, session lifetime, __Host- cookie
# prefix) lives in the dashboard.
#
# Rather than half-Terraform the Clerk config, this module:
#   1. Takes the publishable + secret keys as inputs (created in the
#      dashboard once per env).
#   2. Documents the required dashboard configuration in comments.
#   3. Outputs the keys so downstream modules (Vercel project env vars,
#      GitHub Actions secrets) can consume them uniformly.
#
# When Clerk's TF provider matures, this module can be expanded.

terraform {
  required_providers {
    # No provider needed for the docs-only module. If Clerk's provider
    # matures, uncomment and use:
    # clerk = {
    #   source  = "clerkinc/clerk"
    #   version = "~> 0.5"
    # }
  }
}

# ─── Dashboard configuration checklist (manual, per env) ──────────────────
#
# In clerk.com dashboard → select instance → Configure:
#
# [Authentication]
#   - Email + password: enabled (with verification required)
#   - OAuth: Google + GitHub (optional for users; not required for v1)
#   - MFA: Required for users with the `admin` org role (ADR-005, ADR-011)
#
# [Organizations]
#   - Enabled: yes (this is the tenant model — ADR-005)
#   - Personal accounts: enabled (everyone gets a personal org by default)
#   - Allow members to create orgs: yes
#   - Allow admins to invite by email: yes (used by folder_collaborators)
#
# [Sessions]
#   - Session lifetime: 7 days
#   - Inactivity timeout: 30 minutes (forces re-auth on dormant sessions)
#   - Cookie name prefix: `__Host-` (ADR-002; combined with Secure + no Domain)
#
# [Allowed origins]
#   - https://app.<domain>
#   - https://staging.app.<domain>  (staging env only)
#   - http://localhost:3000        (dev only — remove for prod instance)
#
# [Webhooks]  (configured per the spec; outside this module's scope)
#
# Take the publishable_key + secret_key from the dashboard and put them in
# .tfvars.local as TF_VAR_clerk_publishable_key_<env> and
# TF_VAR_clerk_secret_key_<env>. The env composition wires them into Vercel.
