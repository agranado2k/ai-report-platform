# Infrastructure bootstrap runbook

This document walks a fresh operator through provisioning the platform from zero. Total time: **~2-3 hours**, mostly waiting on DNS propagation and TLS issuance.

Phases 0a-0e of `docs/spec.html` are the contract; this file is the executable runbook.

---

## 0. Accounts (~30 min, mostly clicking)

Create accounts under your operator identity. The order matters only loosely — Cloudflare first because everything else points at the domain there.

- [ ] **GitHub**: `agrando2k` (org for the repo). 2FA enabled.
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

> This section becomes live in Phase 0b. Skip for now if you're only doing the Phase 0a bootstrap.

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
