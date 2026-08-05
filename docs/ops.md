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

**Deploy-window note for NOT NULL column adds** (e.g. migration `0010`
`reports.owner_id`, ADR-0059): between the migration applying and the new build
going live, inserts from a still-running old build (which doesn't set the
column) violate the constraint and fail loudly. Acceptable under this project's
merge-then-deploy flow (the window is seconds); if a longer window ever matters,
split into expand (nullable + backfill) and contract (SET NOT NULL) PRs.

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

## Recovering ids lost to pre-Amendment-3 editor saves

**Symptom.** A report's in-page anchors / table of contents stopped working:
`<a href="#summary">` scrolls nowhere, and the target element has no `id` in
the served HTML. Only reports that were **opened in the editor and saved
before ADR-0062 Amendment 3 shipped** are affected.

**Cause, and why it is not self-healing.** Before Amendment 3 the editor's
schema retained `id` on `<section>` only. Every other element — `<h2>`, `<p>`,
`<div>`, `<li>`, `<td>` — lost its `id` on the first save, in **both** the
served HTML and the `_source.json` sidecar. The fix is forward-only: it stops
new loss, it cannot reconstruct what a past save already dropped. Re-saving
the report will not bring the ids back.

**Recovery — version history.** Pre-edit blobs are **immutable in R2**, so the
uploaded original still exists as an earlier version of the report:

1. List the report's versions (`reports_list_versions` via MCP, or the version
   history in the app UI) and find the last version **before** the first editor
   save — that is the one that still carries the ids.
2. Fetch that version's HTML and confirm it has them (`grep -o 'id="[^"]*"'`).
3. Reconcile: if the report has had no meaningful edits since, re-upload that
   version's HTML to the SAME slug (`reports_upload` with `update_slug`) — the
   report keeps its URL and the ids come back as a new version. If there **have**
   been real edits, hand-merge the ids onto the current HTML instead and
   re-upload that; do not roll the content back over the author's edits.
4. Note that the ids will be deduplicated first-wins on the next editor save
   (`dedupeElementIds`), so a hand-merge that introduces a duplicate `id`
   silently loses the later one. Check for duplicates before re-uploading.

**Anchors that cannot be recovered by this procedure**: an `id` that was on an
inline element (`<span>`, `<a>`, `<code>`, `<strong>`, `<em>`) is still dropped
today — `id` is node-only by design (Amendment 3, Decision 1). Move the anchor
to the enclosing block element (`<p>`, `<h2>`, `<section>`, …) as part of the
re-upload. This is also what the report-authoring guidance now tells generators.

## Merging to `main` — signed merge commits (ADR-0044)

**Current flow:** on a green PR, click the GitHub **"Create a merge commit"**
button. GitHub web-flow signs the merge commit and the PR's own commits land
with their signatures intact, so `require_signed_commits = true` is satisfied
with no bot and no manual protection toggling. Rebase-merge is disabled (GitHub
can't sign rebased commits); squash-merge is enabled as a secondary option.
There is **no operator setup** for this — it's just the merge button.
