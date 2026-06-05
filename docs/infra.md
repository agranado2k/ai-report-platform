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

The advisory lock that `tf.sh` uses to serialize `terraform apply` lives on Neon. We can't have Terraform manage Neon before we have the lock, so this is a one-off manual step.

1. Neon console → **New project** → name it `ai-report-platform-bootstrap`
2. Choose a region; PostgreSQL 16
3. From the project overview, copy the **connection string** for the `main` branch
4. Paste it into `.tfvars.local` as `PG_LOCK_URL`

> The advisory-lock key is `hashtext('tf-' || $env)`. The hashtext semantics are stable across Postgres versions and branches — Phase 0b can replace this bootstrap Neon project with the Terraform-managed one without re-keying any locks.

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

> **`VERCEL_AUTOMATION_BYPASS_SECRET`** lets the `e2e` workflow reach protected
> Vercel previews (else 401). It is **per-project**: paste the *same* value into
> Protection Bypass for Automation on **both** `arp-app-prod` and `arp-view-prod`
> (Settings → Deployment Protection), and store that value as this repo secret.
> Vercel binds the secret at build time, so **redeploy** after changing it. The
> `e2e` job sends it as the `x-vercel-protection-bypass` header.

> **`R2_APP_ACCESS_KEY_ID` / `R2_APP_SECRET_ACCESS_KEY`** are a **separate** R2
> token from the tf-state one — created in the dashboard (R2 → Manage R2 API
> Tokens → **Object Read & Write**, bucket scope **`arp-reports-prod`**), the
> bootstrap-PAT exception ADR-017 allows. They feed `var.r2_access_key_id` /
> `var.r2_secret_access_key`, which the prod composition writes to the Vercel
> app env as `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`. The runtime data-plane
> vars (`DATABASE_URL`, `CLERK_*`, `R2_*`) target **both `production` and
> `preview`** so PR previews can serve upload→view; with no persistent staging
> (2026-06-02), previews share the prod Neon DB + R2 bucket — fine pre-launch,
> revisit with per-PR Neon branches / R2 key prefixes once there's real data.

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

## Common issues

### Stuck advisory lock

If `tf.sh` is waiting for a lock that never releases, a previous invocation likely crashed without cleanup. Inspect:

```bash
psql "$PG_LOCK_URL" -c "SELECT * FROM pg_locks WHERE locktype = 'advisory';"
```

If no live process holds it, release manually:

```bash
psql "$PG_LOCK_URL" -c "SELECT pg_advisory_unlock(hashtext('tf-<env>'));"
```

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
