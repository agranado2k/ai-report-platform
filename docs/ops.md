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
`prod branch <id> db=<name> role=<role>` matches the database the app's
`DATABASE_URL` uses (the project's default `neondb`) — if it targets a different
DB (e.g. the TF-declared `ai_report_platform`), the app will still 500 and the
db-discovery needs reconciling (see the diary drift note).

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

> **Which database holds the data?** Despite the Terraform resource being named
> `neon_database.main` = `ai_report_platform`, the app's `DATABASE_URL`
> (`neon_project.connection_uri`) and the live report data are in Neon's default
> **`neondb`** (owned by `neondb_owner`) — the TF-declared `ai_report_platform`/`app`
> are a separate, currently-unused db/role (the unreconciled drift in the diary).
> So when recovering, the database to re-migrate and verify is **`neondb`**; the
> `migrate-db` run log line `db=<name>` must read `db=neondb`.

## Merging to `main` — signed merge commits (ADR-0044)

**Current flow:** on a green PR, click the GitHub **"Create a merge commit"**
button. GitHub web-flow signs the merge commit and the PR's own commits land
with their signatures intact, so `require_signed_commits = true` is satisfied
with no bot and no manual protection toggling. Rebase-merge is disabled (GitHub
can't sign rebased commits); squash-merge is enabled as a secondary option.
There is **no operator setup** for this — it's just the merge button.

---

## ~~Bot-merge (`/merge`) signing setup — ADR-0035~~ (OBSOLETE, superseded by ADR-0044)

> **Obsolete.** The `/merge` bot never worked on this personal (non-org) repo:
> the `bypass_pull_request_allowances` API returns HTTP 500, so the workflow
> can't push to protected `main`. Replaced by native signed merge commits
> (ADR-0044, above). `bot-merge.yml` + the GPG-key secrets below are slated for
> removal; the steps are kept only for historical context.

The `/merge` bot (`.github/workflows/bot-merge.yml`) rebases a PR's commits onto
`main`, **GPG-signs** them, and pushes. To make `require_signed_commits = true`
accept the result, four things must be in place. Do these once.

### 1. Generate a passphraseless GPG signing key

Use an email that is a **verified email on the `agranado2k` GitHub account**
(Settings → Emails). Web-flow "Verified" requires the committer email to match.

```bash
cat > /tmp/merge-bot-key <<EOF
%no-protection
Key-Type: eddsa
Key-Curve: ed25519
Subkey-Type: eddsa
Subkey-Curve: ed25519
Name-Real: ARP Merge Bot
Name-Email: <your-verified-github-email>
Expire-Date: 0
%commit
EOF
gpg --batch --generate-key /tmp/merge-bot-key && rm /tmp/merge-bot-key

# Get the key id + export both halves
KEYID=$(gpg --list-secret-keys --keyid-format=long --with-colons | awk -F: '$1=="sec"{print $5; exit}')
gpg --armor --export "$KEYID"        > /tmp/merge-bot.pub.asc     # public  → GitHub
gpg --armor --export-secret-keys "$KEYID" > /tmp/merge-bot.key.asc # private → secret
```

`%no-protection` makes it passphraseless (so CI can sign non-interactively).
Keep `/tmp/merge-bot.key.asc` secret and delete it after step 3.

### 2. Register the public key on GitHub

`https://github.com/settings/keys` → **New GPG key** → paste the contents of
`/tmp/merge-bot.pub.asc`. (This is what makes GitHub mark the signed commits
"Verified".)

### 3. Set the repo secrets + variables

```bash
gh secret set   MERGE_BOT_GPG_PRIVATE_KEY < /tmp/merge-bot.key.asc && rm /tmp/merge-bot.key.asc
gh variable set MERGE_BOT_NAME  --body "ARP Merge Bot"
gh variable set MERGE_BOT_EMAIL --body "<your-verified-github-email>"
# MERGE_BOT_TOKEN: fine-grained PAT on agranado2k, this repo only —
# Contents: read+write, Pull requests: read+write, Metadata: read.
gh secret set   MERGE_BOT_TOKEN   # paste the github_pat_… value
```

> Rotate `MERGE_BOT_TOKEN` (PAT expiry) and re-issue on operator account
> changes. The GPG key has no expiry; rotate if compromised.

### 4. Apply the branch-protection PR-bypass

The push to `main` bypasses the "require a PR" rule via
`pull_request_bypassers` (TF `infra/terraform/modules/github-repo`). **Verify it
is actually applied** — a `null` bypass list blocks the push even with valid
signatures:

```bash
gh api repos/agranado2k/ai-report-platform/branches/main/protection/required_pull_request_reviews \
  --jq .bypass_pull_request_allowances     # must include agranado2k, not null
```

If `null`, apply the shared env (`tf.sh shared apply`) or set it in the
dashboard (Settings → Branches → main → *Allow specified actors to bypass
required pull requests* → add `agranado2k`).

### Bootstrap (first time only)

Fixing the bot-merge requires merging the fix — but merging is what's broken.
Break the deadlock once: in **Settings → Branches → `main`**, temporarily
**uncheck "Require signed commits"** (or add `agranado2k` to the PR-bypass and
merge via the bot once signing is set up), land the fix PR, then re-enable.
After that, `/merge` is self-sustaining.
