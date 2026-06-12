# Infrastructure bootstrap runbook

This document walks a fresh operator through provisioning the platform from zero. Total time: **~2-3 hours**, mostly waiting on DNS propagation and TLS issuance.

Phases 0a-0e of `docs/spec.html` are the contract; this file is the executable runbook.

---

## 0. Accounts (~30 min, mostly clicking)

Create accounts under your operator identity. The order matters only loosely — Cloudflare first because everything else points at the domain there.

- [ ] **GitHub**: `agranado2k` (org for the repo). 2FA enabled.
- [ ] **Cloudflare**: account with R2 enabled. Register or transfer the apex domain here.
- [ ] **Vercel**: team plan (free is fine for v1).
- [ ] **Neon**: project for the platform.
- [ ] **Upstash**: account; Redis instances will be Terraform-provisioned.
- [ ] **Clerk**: application with Organizations enabled and MFA required.
- [ ] **Resend**: account; domain to be verified.

Generate per-provider API tokens with **least-privilege scopes** — `.tfvars.local.example` annotates the exact permissions each one needs.

---

## 1. Bootstrap the R2 state bucket (~5 min)

Terraform stores its own state in R2. Chicken-and-egg: the bucket must exist before Terraform can initialize.

1. Cloudflare dashboard → **R2** → **Create bucket**
2. Name: **`tf-state`**
3. Location: pick a region close to you
4. After creation, open the bucket → **Settings**:
   - Enable **Object versioning** (gives us state history)
   - Public access: **Disabled** (default)
5. Create an R2 API token scoped to this bucket only:
   - **R2 → Manage API tokens → Create token**
   - Permissions: **Object Read & Write**
   - Bucket scope: **`tf-state`**
   - Save the **Access Key ID** and **Secret Access Key** — they go into `.tfvars.local` as `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.

> Why R2 and not HCP Terraform Cloud? See **ADR-018**. Short version: we already use Cloudflare; this keeps the vendor surface narrow.

---

## 2. Bootstrap the Postgres lock host (~5 min)

The advisory lock that `tf.sh` uses to serialize `terraform apply` lives on Neon. It only needs **a reachable Postgres** — any Neon project's `main` branch works (the lock touches no data; key = `hashtext('tf-' || $env)`). On a fresh bootstrap you may create a dedicated project for it; in practice this repo's lock points at the platform's own (single) Neon project.

1. Neon console → pick (or create) a project
2. Copy the **connection string** for its `main` branch — **use the DIRECT endpoint host** (no `-pooler`)
3. Set it in `.tfvars.local` as `PG_LOCK_URL` **and** as the `PG_LOCK_URL` GitHub Actions secret (CI reads the secret, not your local file)

> **If the lock host endpoint ever changes or is deleted** (e.g. a Neon project was recreated), repoint `PG_LOCK_URL` — both the local file and the CI secret — at a live direct endpoint. `tf.sh` now fails fast with a clear *"cannot connect to PG_LOCK_URL"* error in that case, rather than a misleading "lock held". The `hashtext` key is stable across hosts, so repointing never re-keys locks.

---

## 3. Configure local secrets (~10 min)

```bash
cd infra/terraform
cp .tfvars.local.example .tfvars.local
$EDITOR .tfvars.local
```

Fill in every value. The file is gitignored — never commit it.

> If you skip a value, `tf.sh` will fail loudly at the `: "${VAR:?...}"` checks. That's intentional; it's better than apply-time failures with cryptic provider errors.

---

## 4. Initialize Terraform (~2 min per env)

```bash
# From repo root
infra/terraform/scripts/tf.sh shared init
infra/terraform/scripts/tf.sh staging init
infra/terraform/scripts/tf.sh prod init
```

Each invocation initializes the S3-on-R2 backend with the env-specific state key (`shared.tfstate`, `staging.tfstate`, `prod.tfstate`). The first run will report "no existing state" — that's correct.

> The `envs/{prod,staging,shared}/` directories ship empty in Phase 0a. They'll be populated by Phase 0b's module composition. `tf.sh init` against an empty env succeeds — Terraform just configures the backend with nothing to manage yet.

---

## 5. Apply in order (~30 min total)

> Once the repo is pushed and GitHub Actions are wired up, **CI handles this for you**. On every PR that touches `infra/terraform/**`, `.github/workflows/terraform.yml` runs `terraform plan` for shared/staging/prod (in parallel) and posts each diff as a sticky PR comment. On merge to `main`, the workflow runs `terraform apply` for **shared → staging → prod sequentially** (a failure in `shared` halts the chain). The commands below are the local-operator escape hatch — first apply on a fresh repo, or recovery situations where you can't go through a PR.

> **DNS is managed as-code** in the `cloudflare-zone` module via the `records` list assembled in `envs/shared/main.tf` (`app_view_records` + `clerk_records` + Resend's records). All app CNAMEs are **DNS-only (`proxied = false`)** — proxying breaks Vercel/Clerk CNAME flattening + cert issuance. **Clerk** custom-domain records live in `local.clerk_records` (`accounts` → `accounts.clerk.services`, `clerk` → `frontend-api.clerk.services`, `clk._domainkey`/`clk2._domainkey`/`clkmail` → the instance DKIM/mail targets). They apply with the shared env; afterwards re-run Clerk's domain **Verify**. Don't add Clerk records by hand in the Cloudflare dashboard — that drifts from this list.

```bash
# Shared resources (single-instance: GitHub repo, Cloudflare zone, Resend)
infra/terraform/scripts/tf.sh shared plan
infra/terraform/scripts/tf.sh shared apply

# Staging — verify everything works here first
infra/terraform/scripts/tf.sh staging plan
infra/terraform/scripts/tf.sh staging apply

# Production — only after staging looks good
infra/terraform/scripts/tf.sh prod plan
infra/terraform/scripts/tf.sh prod apply
```

### Required GitHub Actions configuration

Once the repo lives at `github.com/agranado2k/<repo>`, populate these under **Settings → Secrets and variables → Actions**. The `terraform-shared/github-repo` module also writes the secrets back from Terraform — but the first apply needs them set manually (chicken-and-egg).

**Repository secrets** (`Settings → Secrets`):

| Secret | Source | Used by |
| --- | --- | --- |
| `R2_TF_STATE_ACCESS_KEY_ID` | R2 token scoped to `tf-state` bucket | every job (backend auth) |
| `R2_TF_STATE_SECRET_ACCESS_KEY` | same R2 token | every job (backend auth) |
| `R2_APP_ACCESS_KEY_ID` | R2 token scoped to `arp-reports-prod` (Object R&W) — the **app's** blob store | prod (`TF_VAR_r2_access_key_id`) |
| `R2_APP_SECRET_ACCESS_KEY` | same R2 app token | prod (`TF_VAR_r2_secret_access_key`) |
| `CLOUDFLARE_ACCOUNT_ID` | dashboard URL | every job |
| `CLOUDFLARE_API_TOKEN` | account-scoped Cloudflare token | every env |
| `PG_LOCK_URL` | Neon connection string for the advisory lock | apply jobs |
| `NEON_API_KEY` | Neon API key (full-access) | shared |
| `VERCEL_API_TOKEN` | Vercel PAT | staging, prod, shared (pass-through) |
| `UPSTASH_API_KEY` | Upstash management key | staging, prod |
| `GH_REPO_ADMIN_TOKEN` | GitHub PAT (admin scope for the github_repo module) | shared |
| `CLERK_SECRET_KEY_STAGING` | Clerk test instance secret key | staging |
| `CLERK_SECRET_KEY_PROD` | Clerk live instance secret key | prod |
| `RESEND_API_KEY` | Resend send-only domain key | shared (pass-through) |
| `RESEND_DNS_RECORDS_JSON` | JSON-encoded list from Resend dashboard | shared |
| `ANTHROPIC_API_KEY` | for the Claude PR-review workflow | shared (pass-through) |
| `GEMINI_API_KEY` | for the Gemini PR-review workflow | shared (pass-through) |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Vercel Protection Bypass for Automation secret | `e2e` (BDD smoke against the preview) |

> **Preview access is public** (`vercel_authentication = { deployment_type =
> "none" }` in `modules/vercel-app`) — we gate report access via the viewer's
> own ACL (ADR-0038), not Vercel SSO. So the `e2e` smoke reaches previews
> directly (no 401) and needs no bypass secret. **Pitfall:** `vercel_authentication
> = null` does *not* disable protection — it leaves the team default (Standard
> Protection) on, which 401s anonymous + CI requests; `deployment_type = "none"`
> is required to actually make deployments public.
>
> **`VERCEL_AUTOMATION_BYPASS_SECRET`** is now belt-and-braces: the `e2e` job
> still sends it as `x-vercel-protection-bypass` (harmless when previews are
> public) so the smoke keeps working if Deployment Protection is ever re-enabled.
> If you do re-enable it, the secret is **per-project**: paste the *same* value
> into Protection Bypass for Automation on **both** `arp-app-prod` and
> `arp-view-prod`, store it as this repo secret, and **redeploy** (Vercel binds
> it at build time).

> **`R2_APP_ACCESS_KEY_ID` / `R2_APP_SECRET_ACCESS_KEY`** are a **separate** R2
> token from the tf-state one — created in the dashboard (R2 → Manage R2 API
> Tokens → **Object Read & Write**, bucket scope **`arp-reports-prod`**), the
> bootstrap-PAT exception ADR-017 allows. They feed `var.r2_access_key_id` /
> `var.r2_secret_access_key`, which the prod composition writes to the Vercel
> app env as `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`. The runtime data-plane
> vars (`DATABASE_URL`, `CLERK_SECRET_KEY`, `PUBLIC_CLERK_PUBLISHABLE_KEY`,
> `R2_*`) target **both `production` and `preview`** so PR previews can serve
> upload→view; with no persistent staging (2026-06-02), previews share the prod
> Neon DB + R2 bucket — fine pre-launch, revisit with per-PR Neon branches / R2
> key prefixes once there's real data.
>
> **Browser-exposed vars carry the `PUBLIC_` prefix.** The app's env contract
> (`packages/env`, ADR-0043) routes client-safe vars through `@t3-oss/env-core`'s
> `clientPrefix`, so the Vercel env **key** must be `PUBLIC_CLERK_PUBLISHABLE_KEY`
> (not the bare `CLERK_PUBLISHABLE_KEY`). A name mismatch leaves the var undefined
> and `defineEnv()` throws at boot — `/health` stays green (no `deps()`) while
> every data-plane route (`/upload`, `/r/$slug`) 500s.

> **Vercel project settings** (both `arp-app-prod` + `arp-view-prod`): `TURBO_FORCE=true`
> + `VERCEL_FORCE_NO_BUILD_CACHE=1` (force clean builds so the Remix `vercelPreset()`
> is detected — cached Turbo builds drop it and serve 404), and
> **`autoExposeSystemEnvs: true`** (Settings → Environment Variables) so
> `VERCEL_GIT_COMMIT_SHA` is in `process.env` at build+runtime — the `/health`
> `commit` field relies on it (else it falls back to `"dev"`).

**Repository variables** (`Settings → Variables`):

| Variable | Example | Used by |
| --- | --- | --- |
| `APEX_DOMAIN` | `example.com` | shared |
| `OPERATOR_EMAIL` | `you@example.com` | shared |
| `VERCEL_TEAM_ID` | `team_xxxx…` | staging, prod |
| `UPSTASH_EMAIL` | `you@example.com` | staging, prod |
| `CLERK_PUBLISHABLE_KEY_STAGING` | `pk_test_…` | staging |
| `CLERK_PUBLISHABLE_KEY_PROD` | `pk_live_…` | prod |

---

## 6. Verify (Phase 0d)

> This section becomes live in Phase 0d. Skip for now.

Run the infrastructure E2E suite locally against staging:

```bash
pnpm test:e2e:infrastructure --env=staging
```

All 13 Gherkin features in `tests/e2e/infrastructure/` should pass green. If any fail, **do not proceed to feature development** — fix the infrastructure first. The point of Phase 0 is to know that any later test failure is a code bug, not an environment bug (ADR-019).

---

## Async scan pipeline (ADR-0045)

The async content-scan pipeline runs on infrastructure you already have, plus one free Cloudflare Worker:

- **Queue: pg-boss on the prod Neon database.** It **self-manages** a dedicated `pgboss` schema at runtime (the `app` role owns the DB, so no grant is needed). This schema is **not** in the Drizzle/`migrate-db` pipeline by design (pg-boss 12's partitioned per-queue tables can't be frozen into a static migration). Our `public` app tables still go through Drizzle.
- **Trigger: `modules/scan-cron`** — a Cloudflare Cron Trigger Worker (`arp-scan-drain-prod`, free Workers plan) that POSTs `https://app.<apex>/internal/scan-drain` every minute with a shared bearer secret.
- **workers.dev subdomain** — Cloudflare requires the account to have a workers.dev subdomain before *any* Worker cron trigger can be created (error `10063`). There is **no native TF resource** for this (v4 or v5 — only the per-script `workers_script_subdomain` toggle), so the `scan-cron` module registers it via the API in a `null_resource`, gated before the cron trigger. The registration is **idempotent (GET-then-PUT)**: it `GET`s `/accounts/{id}/workers/subdomain` and only `PUT`s when none is set — the `PUT` itself is **not** idempotent (once a subdomain exists, re-`PUT` returns `success:false`), so re-applies must skip it. The name is `var.workers_subdomain` (default `arp-reports-prod`; cosmetic — the Worker never serves on it). If the apply fails "subdomain taken", change the default.
- **Secret: `SCAN_DRAIN_SECRET`** — a self-generated `random_password` (no operator input), set on the Vercel app for **production + preview** (preview so the e2e can drive the drain itself, since cron only targets prod).
- **Optional `SCAN_QUEUE_DATABASE_URL`** — point pg-boss at Neon's **pooled** endpoint at scale; defaults to `DATABASE_URL` (direct) which is fine for low volume.

**Operator prerequisite (one-time):** the Cloudflare API token (`TF_VAR_cloudflare_api_token`) must include **Workers Scripts: Edit** (in addition to the DNS/zone/R2 permissions it already has) — it's used both by the provider to upload the Worker and by the subdomain `null_resource`. Add it in the dashboard (My Profile → API Tokens → edit the existing token → add `Account · Workers Scripts · Edit`; the token value is unchanged, so no secret update). Everything else (subdomain registration included) is then handled by `apply-prod`.

**Verify after apply:** the Worker appears under Workers & Pages with a cron schedule; `POST https://app.<apex>/internal/scan-drain` with `Authorization: Bearer $SCAN_DRAIN_SECRET` returns `200 {"drained":N,"failed":0}` (401 without the header). Upload a report → it shows the "scanning…" holding page → within ~1 min it serves the content (the cron drain promoted it).

---

## Common issues

### Stuck advisory lock

**First rule out a connectivity problem.** A `tf.sh` advisory lock is session-scoped — a crashed invocation's lock auto-releases when its Postgres session ends — so a *genuinely* stuck lock is rare. Far more common: `PG_LOCK_URL` points at a stale/deleted endpoint or has bad creds, and the lock attempt fails to connect. `tf.sh` now reports that as a clear *"cannot connect to PG_LOCK_URL"* error; if you see it, fix the connection string (live **direct** endpoint, valid creds, in both `.tfvars.local` **and** the CI secret) — there is no lock to clear. Confirm reachability with:

```bash
psql "$PG_LOCK_URL" -c "SELECT 1"
```

If the host is reachable but a lock genuinely persists, inspect it:

```bash
psql "$PG_LOCK_URL" -c "SELECT * FROM pg_locks WHERE locktype = 'advisory';"
```

Then either release it from the holding session, or — since the holding session is usually gone — terminate the lingering backend (advisory unlock from a *different* session is a no-op):

```bash
psql "$PG_LOCK_URL" -c "SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype = 'advisory';"
```

(Local `gh`/`psql` gotcha: don't `source .tfvars.local` before a `gh` command — a bare `GITHUB_TOKEN`/`GH_TOKEN` in that file shadows your `gh` login. Run `gh` with `env -u GH_TOKEN -u GITHUB_TOKEN` if needed.)

### State drift

R2 versioning preserves every prior state file. To roll back:

```bash
# List versions
aws --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" \
  s3api list-object-versions --bucket tf-state --prefix prod.tfstate

# Restore an older version (copies it back as the current version)
aws --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" \
  s3api copy-object \
  --bucket tf-state \
  --copy-source "tf-state/prod.tfstate?versionId=<OLDER_VERSION_ID>" \
  --key prod.tfstate
```

Then `tf.sh prod plan` to confirm the rollback matches reality.

### "Access Denied" from R2

Double-check that `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` are for an R2 token scoped to the `tf-state` bucket, not a separate Cloudflare API token. R2 uses S3-style access keys; Cloudflare's other APIs use bearer tokens. They are not interchangeable.

---

## Phase 0a exit criteria

Before merging the Phase 0a PR:

- [ ] `tf-state` bucket exists in R2 with versioning enabled
- [ ] `tf.sh shared init` succeeds (acquires no lock, configures backend)
- [ ] `tf.sh staging init` succeeds
- [ ] `tf.sh prod init` succeeds
- [ ] A deliberate `pg_advisory_unlock` test confirms the lock semantics work
- [ ] `.tfvars.local` is gitignored (verified by `git check-ignore .tfvars.local`)

Next: **Phase 0b** writes the Terraform modules and runs the first real `apply`.
