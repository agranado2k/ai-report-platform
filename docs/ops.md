# Operations runbook

Operator procedures that aren't fully captured by Terraform — credential
issuance, one-time bootstraps, rotations.

## Re-running prod migrations (`migrate-db`)

The `migrate-db` workflow applies Drizzle migrations to the prod Neon `main`
branch. **Migrate-on-deploy: it auto-runs on EVERY push to `main`.** `drizzle-kit
migrate` is idempotent, so when prod is current it's a no-op, and when prod is
behind (e.g. a `terraform apply` recreated the Neon branch and wiped the schema,
as in 2026-06: `br-tiny-hall-aqqs1klw` → `br-wispy-flower-aqtttj6n`) the next
merge self-heals it — **no human in the loop**. Safe because `migration-check`
validates every migration on the PR (an ephemeral Neon branch) before it reaches
`main`.

A **`workflow_dispatch`** trigger remains as a manual escape hatch — to recover
immediately without waiting for the next push:

```bash
gh workflow run migrate-db.yml --ref main
sleep 5   # let the new run register, else `run list` returns the PREVIOUS run
# then watch it + confirm which DB it targeted:
gh run watch "$(gh run list --workflow=migrate-db.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
```

Or use the GitHub UI: **Actions → Migrate DB (prod) → Run workflow**. The apply is
idempotent (drizzle tracks applied migrations in `__drizzle_migrations`), so a
dispatch on an already-current branch is a safe no-op. **Verify** the run log line
`prod branch <id> db=<name> role=<role>` must read **`db=ai_report_platform
role=app`** — the dedicated db/role the app's `DATABASE_URL` points to. If it
targets anything else, the app will 500 (`relation … does not exist`) because
the schema landed in the wrong database.

## Prod Neon DB — destroy protection

The prod Neon `neon_project` / `neon_database` / `neon_role`
(`infra/terraform/modules/neon-project`) carry `lifecycle { prevent_destroy = true }`.
Any `terraform apply` whose plan would **destroy or replace** them now **fails at
plan time** rather than silently recreating prod (which already happened once and
wiped the schema — see `migrate-db.yml` + the diary).

**If `tf.sh shared plan/apply` errors with `Instance cannot be destroyed` on a
neon resource, that is the guard working — do NOT force past it casually.** It
means some change wants to *replace* the prod DB. Steps:

1. Read the plan: find which attribute forces replacement (Neon immutable fields
   like `region_id` / `pg_version` / `org_id` are common culprits). Fix the config
   so it no longer forces a replace, if possible.
2. Only if a destroy is genuinely intended (e.g. a deliberate prod migration to a
   new project, data already backed up via PITR/branch): **explicitly** remove the
   `prevent_destroy` block in a dedicated PR, apply, then add it back. There is no
   bypass flag — removing the guard in a reviewed PR *is* the explicit "yes".
3. After any prod-branch recreation, re-run **`migrate-db`** (`gh workflow run
   migrate-db.yml --ref main`) — the fresh branch has no schema.

> **Which database holds the data?** The app uses the dedicated TF-declared
> database **`ai_report_platform`** (owned by role **`app`**) — both the app's
> `DATABASE_URL` (built from `neon_role.main` + `neon_database.main` in the
> neon-project module) and `migrate-db` target it. So recovery re-migrates and
> verifies **`ai_report_platform`**; the `migrate-db` log line must read
> `db=ai_report_platform role=app`.

## Merging to `main` — signed merge commits (ADR-0044)

**Current flow:** on a green PR, click the GitHub **"Create a merge commit"**
button. GitHub web-flow signs the merge commit and the PR's own commits land
with their signatures intact, so `require_signed_commits = true` is satisfied
with no bot and no manual protection toggling. Rebase-merge is disabled (GitHub
can't sign rebased commits); squash-merge is enabled as a secondary option.
There is **no operator setup** for this — it's just the merge button.
