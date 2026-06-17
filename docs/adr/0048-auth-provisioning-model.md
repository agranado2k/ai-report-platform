# ADR-0048: Auth provisioning & integration model (Clerk JIT personal-org)

- **Status**: Accepted
- **Date**: 2026-06-16
- **Deciders**: agranado2k
- **Supersedes / amends**: refines ADR-005 (Clerk Organizations from day 1). Builds on ADR-0036 (Identity & Access bounded context), ADR-0020 (repository pattern), ADR-0024 (no I/O in domain).
- **Superseded by**: —

## Context and problem statement

The app authenticates every request as a hard-coded `DEMO_ACTOR`; the upload API is effectively open. ADR-005 mandates Clerk with Organizations from day 1, every user belonging to ≥1 Clerk org, and a personal org per user. The schema enforces this — `orgs.clerk_org_id` and `users.clerk_user_id` are NOT NULL + unique — so a personal `Org` is a **real Clerk Organization** mirrored 1:1 into our DB, not a DB-only construct.

Two things had to be settled before writing auth code: (1) **how** a new user's personal Clerk Org comes to exist and gets mirrored, and (2) how automated tests authenticate once `DEMO_ACTOR` is gone — plus the cost of a personal-org-per-user model.

Research (Clerk docs, 2026-06): Clerk does **not** auto-create personal organizations — the application must create them (backend `createOrganization`, or a forced UI flow). Clerk's current pricing bills **Monthly Retained Organizations** (≥1 retained user → a single-member personal org counts): **100 MROs free**, then ~$1/MRO/mo. So personal-org-per-user is free below ~100 active orgs and ~$1/active-user/mo beyond.

## Decision drivers

- Honor ADR-005's tenancy model; keep the upload path attributable to a real `Org`.
- Minimize moving parts for the invite-only MVP (no new infra unless it earns its keep).
- Keep provisioning policy in the application layer (ADR-0024); push Clerk/DB I/O behind ports (ADR-0020).
- Ship no auth-bypass code into production.

## Considered options

**Provisioning trigger**
1. **JIT, app-creates-org** — on the first authenticated request, if the session has no active org, call Clerk `createOrganization`, then mirror. No webhooks, immediate consistency.
2. **Webhooks (Svix)** — mirror Clerk→DB from `user.created`/`organization.created`. But Clerk doesn't auto-create personal orgs, so webhooks can't *create* them — only sync. Adds a signed endpoint + dashboard config; eventually-consistent.
3. **Clerk-native auto-org** — not offered by Clerk.

**Tenancy/cost**
A. **Per-user personal Clerk Org** (ADR-005) — free <100 active orgs; ~$1/active-user/mo beyond.
B. **Clerk Personal Accounts** (no org for solo users) — avoids MRO cost, but needs `clerk_org_id` nullable + amends ADR-005.

**e2e auth**: Clerk testing tokens (real path) vs a CI-only bypass vs API keys.

## Decision outcome

- **Provisioning = JIT, app-creates-org (option 1 + A).** `resolveUploadActor` resolves the Clerk session → `provisionIdentity`: if the session has no active org, create a personal Clerk Org via the backend API, then find-or-create the mirrored `User` + `Org` (default `Plan` `free`) + `Root folder`. Policy lives in the `provisionIdentity` use case; Clerk and DB I/O sit behind the `ClerkOrgProvisioner` and `IdentityStore` ports.
- **e2e / prod-verification = Clerk testing tokens** (`@clerk/testing`) + a seeded test user on the **staging** Clerk instance. No bypass branch ships.
- **Invite-only = Clerk restricted mode / email allowlist** on the staging + prod instances (auth-provider config, akin to the per-provider PAT exception in ADR-017).
- **Webhooks deferred** — an optional ongoing-sync layer (email/membership/deletion) for later, not a creation mechanism.
- **Per-env instances**: staging Clerk keys for previews/dev, prod keys for prod.

## Consequences

- The open upload API becomes session-authenticated; `DEMO_ACTOR` is removed (slice 1b).
- **Cost tripwire:** personal-org-per-user is free for the friends MVP but costs ~$1/active-user/mo past 100 active orgs. **Revisit the model (→ Clerk Personal Accounts, option B) before approaching ~100 active orgs.**
- First authenticated request pays a one-time provisioning cost (Clerk org create + mirror); subsequent requests are a single lookup.
- No webhook means our mirror can drift from Clerk on out-of-band changes (email edits, deletions) until the deferred sync layer lands.

## More information

Delivered in slices: 1a — `provisionIdentity` use case + `IdentityStore`/`ClerkOrgProvisioner` ports + Drizzle/in-memory adapters (no Clerk wired); 1b — `@clerk/remix`, sign-in/up, `resolveUploadActor`→session, the real Clerk provisioner, drop `DEMO_ACTOR`, testing-token e2e. Tracked by GitHub issue #54. Cost research: Clerk pricing (MRO model), 2026-06.

**Per-env instances (implemented):** `envs/prod/main.tf` instantiates a second `clerk-app` module (`module.clerk_staging`, `env = "staging"`) and splits the two Clerk env vars by Vercel `target` — `production` gets the live keys (`module.clerk`), `preview` gets the staging/test keys (`module.clerk_staging`). The app reads the same names (`PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY`) on both targets; only the value differs. This closes the Clerk-preview gap that ADR-0047 deferred to this track: a PR preview now authenticates against the test instance, never the prod user pool. Requires the `clerk_publishable_key_staging` / `clerk_secret_key_staging` TF vars (CI applies via the pipeline, ADR-0018 — never manually).
