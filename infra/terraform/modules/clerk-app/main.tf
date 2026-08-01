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
#   - Default membership limit: 20 (raised from the free-tier default 5 via
#     PATCH /v1/instance/organization_settings {"max_allowed_memberships": 20}
#     — free; headroom for team orgs, ADR-0074)
#   - Slugs: auto-generated on prod (slug_disabled) — NOTHING may key on org
#     slugs (the join key is the app-owned orgs.domain index, ADR-0074)
#   - Organization domains: leave DISABLED — enabling 402s on the free plan
#     (Verified Domains = the $100/mo B2B add-on). Team-org identity lives in
#     publicMetadata.domain (the anchor), verified fail-closed before any join.
#     ADR-0074 records when to buy the add-on (>20 members/org, >100
#     multi-member orgs, custom roles, SSO-linked orgs).
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
# [Webhooks]  (Svix endpoint; outside this module's scope — dashboard-only)
#   - Endpoint: https://app.<domain>/webhooks/clerk
#   - Event filter MUST include: user.deleted (ADR-0054 soft-delete mirror)
#     AND user.created (ADR-0074 silent domain auto-join)
#   - Signing secret (whsec_…) → TF_VAR_clerk_webhook_signing_secret
#
# Take the publishable_key + secret_key from the dashboard and put them in
# .tfvars.local as TF_VAR_clerk_publishable_key_<env> and
# TF_VAR_clerk_secret_key_<env>. The env composition wires them into Vercel.
