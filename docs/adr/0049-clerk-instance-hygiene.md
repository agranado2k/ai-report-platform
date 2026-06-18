# ADR-0049: Clerk dev/prod instance separation & the data-orphaning incident

- **Status**: Accepted
- **Date**: 2026-06-18
- **Deciders**: agranado2k
- **Supersedes / amends**: amends ADR-0048 (auth provisioning model — §"Per-env instances") with the operational rules + incident record. Builds on ADR-0017 (everything-as-code / per-provider secret exception), ADR-0018 (Terraform via `tf.sh`).
- **Superseded by**: —

## Context and problem statement

ADR-0048 established per-environment Clerk instances: **staging/dev keys for previews, prod keys for prod**. The mechanism is correct in Terraform (`envs/prod/main.tf` wires `module.clerk` — the live keys — to the Vercel `production` target, and `module.clerk_staging` — the dev/test keys — to the `preview` target, both surfaced as `PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY`).

In June 2026 the dashboard showed **no reports for the signed-in operator** even though the report rows existed in the prod database. Root cause: **early prod uploads were authenticated against the *dev* Clerk instance** (`sk_test`), so `provisionIdentity` mirrored the operator's identity + org under a **dev-instance** test user (`ag47+clerk_test@agranado.com`, org `Ag47 Org`). Prod's frontend later moved to the **live** instance (`pk_live`, `clerk.agranado.com`); the operator's real Google login is a **different identity on the live instance**, so `findByClerk(liveUserId, liveOrgId)` resolved a different (empty) org and the dashboard rendered empty. The data was never lost — it was **orphaned across two Clerk instances**.

This was diagnosed and the mirror was **re-keyed** (the existing `orgs`/`users` rows had their `clerk_org_id` / `clerk_user_id` re-pointed from the dev-instance ids to the operator's live-instance ids), reconnecting all reports to the live login. The remaining risk is **recurrence + confusion**: nothing documented which instance is canonical for prod, and stale local config still referenced the dev instance under `*_prod` names.

## Decision drivers

- Tenant data must follow the operator's **real (live) identity**, not a transient test identity.
- Clerk's dev/prod isolation (test users, separate user pools) is valuable and should be kept.
- A single, unambiguous **source of truth** for which instance each environment uses.
- Cheap, durable guardrails against a silent instance switch orphaning data again.

## Considered options

1. **Keep the dev/prod split and harden it with explicit rules + this record** (chosen).
2. **Collapse to a single Clerk instance for all environments** — rejected: mixes e2e/test users into the prod user pool and loses Clerk's dev/prod isolation.
3. **Point prod back at the dev instance** (where the original data was created) — rejected: a dev instance is not production-grade (dev-browser tokens, lax limits); the live instance is correct for prod.

## Decision outcome

- **Canonical mapping**: **production → live Clerk instance** (`pk_live` / `sk_live`, issuer `clerk.agranado.com`); **preview + e2e → dev/test instance** (`pk_test` / `sk_test`). Reaffirms ADR-0048.
- **Single source of truth** for the keys Terraform applies: GitHub Actions **`secrets.CLERK_SECRET_KEY_PROD`** + **`vars.CLERK_PUBLISHABLE_KEY_PROD`** (live), and **`*_STAGING`** (dev). `envs/prod/main.tf` is the only place that maps them to Vercel targets. Infra applies **only via the pipeline** (ADR-0017); no local `terraform apply`.
- **Hygiene invariants** (guardrails against recurrence):
  - `infra/terraform/**/secrets.auto.tfvars` and `**/*.auto.tfvars` are **git-ignored** (verified) — a Clerk key never lands in version control. Local `secrets.auto.tfvars` placeholders (e.g. `sk_live_REPLACE_ME`) only affect a forbidden local apply, never CI.
  - A **`*_prod` Terraform variable must never hold an `sk_test` / `pk_test` value** — that mismatch is the exact fingerprint of this incident.
  - A developer's local `infra/terraform/.tfvars.local` should carry the **live** secret so diagnostic tooling can query the prod instance (the stale `sk_live` there during the incident is why the live instance couldn't be inspected without decoding a session JWT).
- **Switching instances is a migration, not a config edit**: changing the instance a live environment uses **orphans existing tenant data** and requires a deliberate re-key/migration plan — never a silent secret swap.

## Consequences

- **Positive**: clean dev/prod isolation; no test users in the prod pool; tenant data follows the operator's real identity; a documented incident + remediation so the failure mode is recognized instantly next time.
- **Negative / trade-offs**: two Clerk instances to manage; a future instance change carries a data-migration obligation (above). The personal-org cost tripwire from ADR-0048 still applies.
- **Follow-ups**: the one-off re-key SQL is recorded in the session memory note (`clerk-prod-instance-split`); issue #76 tracked this work.

## More information

- The orphaned data was reconnected by re-keying the mirror rows (`UPDATE orgs SET clerk_org_id = <live org>` / `UPDATE users SET clerk_user_id = <live user>, email = …`), not by moving reports — `reports.org_id` references the row id, so all reports followed automatically.
- Diagnosis path when an instance question recurs: the live `sk_live` may be stale locally, so query Clerk with the `_staging` (`sk_test`) key, or decode a `__session` JWT (the `o.id` / `sub` claims) to see the active org + user the browser presents.
