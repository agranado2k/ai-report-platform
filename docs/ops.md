# Operations runbook

Operator procedures that aren't fully captured by Terraform — credential
issuance, one-time bootstraps, rotations.

## Re-running prod migrations (`migrate-db`)

The `migrate-db` workflow applies Drizzle migrations to the prod Neon `main`
branch. It auto-runs on `push` to `main` that touches `packages/db/**` (a schema
change). It also has a **`workflow_dispatch`** trigger for the case the path
trigger can't catch: **the prod schema is lost without a schema-file change** —
e.g. a `terraform apply` recreates the Neon project/branch (as in 2026-06, when
the prod branch went `br-tiny-hall-aqqs1klw` → `br-wispy-flower-aqtttj6n`). Then
the fresh branch has no schema and nothing re-applies it.

To re-migrate the current prod branch **via CI/CD** (never by hand):

```bash
gh workflow run migrate-db.yml --ref main
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
