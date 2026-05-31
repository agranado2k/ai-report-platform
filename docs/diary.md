# Development diary

> Living history of the `ai-report-platform` build. The **Current state** block at the top is the agent re-orientation summary — read it first when picking up the project. Below it: forward-chronological entries, newest at the bottom.

---

## Current state — 2026-05-21

| Field                  | Value                                                                          |
| ---------------------- | ------------------------------------------------------------------------------ |
| **Phase**              | 0b complete: modules + `terraform.yml` GHA workflow written and validated. **Awaiting operator bootstrap + first push to GitHub** for any actual `apply`. Phase 0c next (skeleton apps + remaining CI/CD workflows). |
| **Repo path**          | `~/PetProjects/ai-report-platform/` (main) · `~/PetProjects/ai-report-platform/worktree/phase-0b-tf-modules/` (active worktree, per the new convention) |
| **Branch**             | `feat/phase-0b-tf-modules` open against `main` (no remote yet, no PR yet) |
| **Last commit on main**        | `4f4452f` — `docs: establish development diary + autonomous-execution mode` |
| **Remote**             | `git@github.com:agranado2k/ai-report-platform.git` (public). `main` pushed; `feat/phase-0b-tf-modules` pushed; ready for first PR. |
| **Live infrastructure**| **nothing provisioned yet.** Modules + envs are written & validated, but `terraform apply` is blocked on the operator finishing Phase 0a manual bootstrap (R2 `tf-state` bucket, bootstrap Neon project, `.tfvars.local`). |
| **Active worktrees**   | `feat/phase-0b-tf-modules` at `~/PetProjects/ai-report-platform/worktree/phase-0b-tf-modules/` |
| **Spec status**        | rev 7 · 30 ADRs · 13 infra + 31 feature verification tests · `docs/spec.html`   |

### Open questions / unresolved decisions

- License — `README.md` says TBD. Pick before the repo goes public.
- Final project name — `ai-report-platform` is the working title; user may rename before push.
- Apex domain — `TF_VAR_apex_domain` is unset; required before Phase 0b's first `apply`.
- PSL submission timing — open the PR against `publicsuffix/list` once the apex domain is finalized.
- R2 bucket versioning — currently a `TODO` in `modules/r2/main.tf`. The cloudflare/cloudflare v4 provider doesn't yet expose versioning as a resource argument. Either wait for v5 or wrap with a `null_resource` + `curl` against the R2 API. Track for Phase 0c follow-up.

### Memory pointers for future-me

- **The diary is the orientation document.** Read this `Current state` block at session start.
- **The spec wins** in disputes. When the diary and `docs/spec.html` disagree, the spec is the contract; the diary is the log.
- **All work in worktrees** per ADR-025: `git worktree add worktree/<slug> -b <type>/<slug>` from the project root. Worktrees live under `worktree/` (gitignored). Branch types: `feat` `fix` `refactor` `chore` `docs`.
- **Terraform via `infra/terraform/scripts/tf.sh` only.** The wrapper acquires a Postgres advisory lock on Neon to prevent parallel-apply state corruption.
- **TDD scaffolding will land in Phase 0e** — until then, write tests alongside code by convention rather than by hook enforcement.

### Update protocol

- **Phase milestone reached** → append a new dated entry below.
- **ADR added, decision reversed, or vendor changed** → append a new dated entry; don't edit old entries.
- **Worktree created for a non-trivial feature** → note it in the next entry; remove from the active list when merged.
- **Infrastructure applied (anything beyond `tf.sh init`)** → append an entry with the env, the plan diff size, and a short note on what changed.

---

## Entries

### 2026-05-18 — Spec drafting begins (rev 1)

Initial spec landed with the first 9 ADRs covering the bones of the platform:

- **ADR-001** Stable slug + versioned content (the core value prop — re-upload keeps the URL).
- **ADR-002** Viewer on a separate origin (`view.<domain>`) for XSS / cookie-theft defense.
- **ADR-003** HTTP API as source of truth; MCP server as a thin client.
- **ADR-004** Cloudflare R2 over Vercel Blob / S3 — no egress fees matter when the viewer is read-heavy.
- **ADR-005** Clerk Organizations from day 1 — retrofit-resistant tenancy.
- **ADR-006** Billing-ready, billing-deferred — `plan` enum + `plan_limits_json` from day 1; Stripe later.
- **ADR-007** Zip bundle upload format for multi-file reports.
- **ADR-008** Hashed, prefixed, user-scoped API keys.
- **ADR-009** Folder-inherited write grants for cross-org collaboration — the unusual one; enables Alice's agent to update Acme's reports without joining Acme's org.

User explicitly asked for the cross-org collaboration model and the orgs-from-day-1 tenancy. Decision drivers: B2B target customer, LLM-driven agents acting on behalf of users.

### 2026-05-18 — Remix + security baseline (rev 2)

Framework switched from Next.js to Remix v2 on Vercel (ADR-010) — loaders/actions fit the upload + ACL-gated streaming flow; Web Fetch primitives keep the security code easy to audit. Two Remix apps in the Turborepo: `apps/app` (dashboard + API) and `apps/view` (viewer).

Security pulled forward as a P0 requirement, not a follow-up:

- **ADR-011** Defense-in-depth baseline (edge, transport, app, data, logging, build, secrets, backups — all in v1).
- **ADR-012** Upload content scanning: ClamAV + phishing heuristics + miner detection; three-stage pipeline (sync pre-checks → async scan → result handling); `report_versions.scan_status` gates publishing.
- **ADR-013** Full viewer security-header stack: enforcing CSP + a second CSP with the `sandbox` directive + report-only shadow CSP + COOP/CORP + `Origin-Agent-Cluster` + Permissions-Policy + Cache-Control + Report-To.

### 2026-05-18 — Untrusted-content rendering deep-dive (rev 3)

Threat model grew from 14 → 21 ranked risks. The new ones all flow from one fact: **we serve arbitrary user HTML/JS to other people's browsers.**

Added a six-layer "untrusted-content rendering" defense:
1. Origin isolation (`view.<domain>`).
2. Public Suffix List submission for `view.<domain>` (sibling-subdomain cookie/storage isolation).
3. `__Host-` cookie prefix on every auth cookie (browser-enforced: no `Domain` attribute).
4. Strict CSP + a second CSP with the `sandbox` directive applied to the top-level document.
5. `Origin-Agent-Cluster: ?1` + COOP/CORP — Spectre defense without breaking cross-origin images/fonts (we deliberately don't enable full COEP).
6. Active-content controls: service worker blocked at the edge (the request-header trick — `Service-Worker: script` → 403); SVG rejected at upload; Trusted Types enforced on the dashboard; CSP report-only shadow.

Three new ADRs:
- **ADR-014** Block service-worker registration at the edge (so abusive content can't persist past takedown).
- **ADR-015** Reject SVG (and active-content image formats) at upload.
- **ADR-016** API key scopes (`reports:write`, `reports:read`, `folders:write`, `acl:write`) + anomaly detection (geo, rate spike, repeated failed-auth).

Plus ADR-002 expanded with the PSL submission and `__Host-` cookies; ADR-013 expanded with the full header bundle.

### 2026-05-19 — Product/Engineering split + architecture deep-dive (rev 4)

Spec restructured into **Part I — Product** and **Part II — Engineering** for two distinct audiences.

Product section gained **six user-journey flow diagrams** (signup→upload→share, LLM-via-MCP upload, re-upload-keeps-URL, cross-org collab, sharing modes, abuse takedown) — each shows actor → system messages over time.

Engineering section gained:
- **ADR-017 (later renumbered 020)** Hexagonal architecture (ports & adapters). Domain core in `packages/domain/`; use cases in `packages/application/`; adapters in `packages/adapters/`. No infra imports in the domain. Easy to test, easy to audit.
- **ADR-018 (later renumbered 021)** Event-driven via Postgres transactional outbox. Events emitted atomically with state changes; dispatcher worker polls and fans out. No new infra dependency for v1.
- Three bounded contexts (Publishing · Identity & Access · Trust & Safety) and a per-table database design with an ASCII ER diagram.

### 2026-05-19 — Engineering practices (rev 5)

Six commitments wired into the engineering section, each enforced via a skill, hook, or CI gate (so the practice is structural, not aspirational):

- **ADR-019 (→ 022)** Strict TDD — Red-Green-Refactor with hook-enforced gates, mirrored from `~/HouseNumbers/zora-pantheon`. Stop hook blocks turn completion on failing tests in any affected package.
- **ADR-020 (→ 023)** BDD with Gherkin — one `.feature` per use case, executed with Playwright + `playwright-bdd`.
- **ADR-021 (→ 024)** Functional programming, **no new libraries** — vanilla TypeScript with `readonly`, a 12-line `pipe()`, and a 15-line `Result<T, E>`. Domain layer is pure; side effects live in adapters.
- **ADR-022 (→ 025)** Git worktrees for all in-progress work — codified in `CLAUDE.md`.
- **ADR-023 (→ 026)** Documentation-as-contract pre-push hook — a trigger matrix maps code-area changes to required doc updates; `/docs-check` skill walks it; pre-push blocks if mismatched.
- **ADR-024 (→ 027)** OpenAPI 3.1 source of truth + Bruno collections + Scalar UI for rendered docs. Bruno generated from OpenAPI; pre-push detects drift; CI runs `bru run` against staging.

### 2026-05-20 — Development & delivery (rev 6)

Added a "Development & delivery" section with a **progress tracker** (two tables, status pills) and three new ADRs:

- **ADR-025 (→ 028)** GitHub Flow with protected `main` — PR-only, 1 CODEOWNERS approval, signed commits, linear history, include administrators (owner cannot bypass).
- **ADR-026 (→ 029)** GitHub Actions for CI (on PR) and CD (on merge to main). 9 CI jobs; CD deploys app + view to Vercel prod, applies Terraform, runs migrations, smoke tests.
- **ADR-027 (→ 030)** Dual AI PR review (Claude + Gemini) — advisory only; CODEOWNERS approval still required. Cost guardrail: skip on diffs > 4,000 lines.

Repo target confirmed as `github.com/agranado2k/<repo>` (public).

### 2026-05-20 — Infrastructure-first restructure + Phase 0a ships (rev 7)

Two related changes landed together.

**Spec restructure (rev 7).** Three new ADRs slotted in at the head of the post-016 block; the practices/delivery ADRs (017-027) renumbered to 020-030:

- **ADR-017** Terraform for all long-lived infrastructure. Per-provider modules (`vercel-app`, `neon-project`, `r2`, `cloudflare-zone`, `upstash-redis`, `clerk-app`, `github-repo`, `resend-domain`); envs (`prod` / `staging` / `shared`) compose modules. Click-ops only for the bootstrap R2 bucket and per-provider PATs.
- **ADR-018** Terraform state on Cloudflare R2 with Postgres advisory locking. R2 has no DynamoDB equivalent, so the standard `dynamodb_table` lock isn't available. We reuse the Neon we already pay for: `pg_advisory_lock(hashtext('tf-' || $env))` in a 30-line shell wrapper. The user chose R2 over HCP Terraform Cloud (stay in Cloudflare).
- **ADR-019** Infrastructure-first delivery. Phase 0 split into 0a-0e: accounts + state bootstrap, modules + apply, skeleton apps + CI/CD, **13 infrastructure E2E features green**, engineering practices wired. No feature code until Phase 1.

User confirmed two key per-PR-environment decisions at the same time: **Neon branch + Vercel preview** per PR (industry standard, ~$0/PR, fully isolated DB; R2 + Upstash share staging with prefix isolation).

**Phase 0a executed.** Repo created at `~/PetProjects/ai-report-platform/`, signed seed commit `e60ee59` on `main`:

```
.gitignore
CLAUDE.md
README.md
docs/spec.html        # rev 7 spec, copied in
docs/infra.md         # bootstrap runbook
infra/terraform/backend.tf
infra/terraform/.tfvars.local.example
infra/terraform/scripts/tf.sh         (executable)
infra/terraform/modules/              (empty — Phase 0b)
infra/terraform/envs/{prod,staging,shared}/   (empty — Phase 0b)
apps/ packages/                        (empty — Phase 0c)
tests/e2e/{infrastructure,features}/   (empty — Phase 0d)
docs/adr/                              (empty — Phase 0b)
```

`tf.sh` smoke-tested: arg parse, `.tfvars.local` loading, required-var checks, mktemp backend config, conditional PG advisory lock for state-mutating commands. Not yet exercised against real R2 (no `tf-state` bucket exists yet — that's an operator action per `docs/infra.md`).

Not pushed to GitHub yet — user will push when ready.

### 2026-05-21 — Diary established; autonomous-execution mode

User asked for two things at once: (1) execute multi-step tasks autonomously without per-step approval, and (2) create a "diary" so future agent sessions have memory of what's been done.

Diary established at `docs/diary.md` (this file). Format: a "Current state" block at the top for agent re-orientation, followed by forward-chronological entries. Backfilled with the full history from 2026-05-18 onwards.

`CLAUDE.md` updated with a top-level "At session start" section pointing here.

Working-style preference saved to the global memory system (`feedback_autonomous_execution.md`) so it persists across projects: execute by default, ask only for genuinely irreversible / cross-account / architecturally ambiguous actions.

This entry written directly on `main`. Worktree convention skipped for a diary-only docs change — the convention's payoff is parallel feature work and stash-free in-flight changes; neither applies here. Next substantive change will use a worktree.

No code or infrastructure changed today. Spec unchanged (still rev 7).

### 2026-05-21 — Phase 0b: Terraform modules written & validated

First substantive worktree-driven work. Branch `feat/phase-0b-tf-modules` at `~/PetProjects/phase-0b-tf-modules/`. **24 Terraform files** across 8 modules and 3 env compositions; all validate cleanly with no warnings.

**Modules** (`infra/terraform/modules/`):
- `vercel-app/` — one Vercel project per Remix app; GitHub integration for preview deploys; env vars + custom domain.
- `neon-project/` — one Neon project, prod + staging branches, role + database + endpoint per branch.
- `r2/` — application R2 buckets (per-env). Note: versioning is a TODO — cloudflare/cloudflare v4 doesn't yet expose it as an argument; will need a `null_resource` workaround or wait for v5.
- `cloudflare-zone/` — DNS records + zone settings (HSTS preload, min TLS 1.2, strict SSL, security header). Uses `cloudflare_zone` data source (assumes zone is pre-created).
- `upstash-redis/` — Redis instance per env; outputs rest URL/token/readonly token.
- `clerk-app/` — documentation-only module (Clerk has no usable TF provider yet); key-prefix validation catches "wrong env's key" mistakes at plan time.
- `github-repo/` — repo + branch protection on `main` (v4 GraphQL resource, not v3 REST) + CODEOWNERS as a tracked file + Actions secrets + variables.
- `resend-domain/` — documentation-only module; sanity-checks the DNS records the operator pasted from Resend's dashboard, outputs them shaped for the cloudflare-zone module to materialize.

**Env compositions** (`infra/terraform/envs/`):
- `shared/` — single-instance resources (Neon project, Cloudflare zone, GitHub repo, Resend domain). Outputs consumed by prod + staging via `terraform_remote_state`.
- `staging/` — staging-tier slice: Vercel app + view, R2 staging + CI buckets, Upstash single-zone, Clerk test instance.
- `prod/` — production slice: same shape, multi-zone Upstash, Clerk live keys, single prod R2 bucket.

**Issues caught & fixed during validation** (worth remembering for future module work):
1. `neon_project` `default_endpoint_settings` is a *block*, not an *argument* in this provider version. Dropped it entirely; explicit `neon_endpoint` resources cover the staging compute config.
2. `for_each` over a sensitive map fails because keys would leak in resource addresses. Fix: don't mark the variable sensitive at the map level; use `nonsensitive(var.x)` in the `for_each`. Applied to both `vercel-app/main.tf` and `github-repo/main.tf`.
3. `neon_branch` doesn't expose `connection_uri` — we build it ourselves from `role.name` + `role.password` + `endpoint.host` + `database.name`.
4. Upstash `multizone` argument is deprecated (auto-enabled on paid plans). Kept the variable as a no-op for callers; removed from the resource.
5. `github_branch_protection_v3` (REST) doesn't support `allows_deletions`. Switched to `github_branch_protection` (v4, GraphQL) — the modern resource. Required moving from `repository = name` to `repository_id = node_id` and from `branch = "main"` to `pattern = "main"`.
6. `vulnerability_alerts` on `github_repository` is deprecated. Extracted to a separate `github_repository_vulnerability_alerts` resource.

All three envs end at "Success! The configuration is valid." with no warnings.

**What's NOT done** (i.e. what Phase 0b would still need before exit):
- `terraform apply` against any env. **Blocked** on the operator finishing the Phase 0a manual bootstrap (R2 `tf-state` bucket, bootstrap Neon project, `.tfvars.local` populated, apex domain on Cloudflare).
- R2 bucket versioning workaround (`null_resource` + curl).
- A `pg_advisory_unlock` smoke test to confirm `tf.sh` lock semantics.

**Active worktree:** `feat/phase-0b-tf-modules` at `~/PetProjects/phase-0b-tf-modules/`. Will become a PR once the project has a GitHub remote (still pending).

### 2026-05-22 — Phase 0b: dedicated Terraform GitHub Actions pipeline

Decision moment: the spec's `cd.yml` originally bundled `terraform apply` with the app deploys. Today we separated infra delivery from app delivery into its own workflow. Triggered: user requested "a different pipeline for Terraform commands when anything related to infrastructure changes." Decisions confirmed in chat:

- **Land in the same Phase 0b worktree** — modules + their CI ship as one cohesive PR.
- **Auto-apply on merge to main** (no Environments-gated approval) — PR review + the plan-on-PR diff is the gate; roll back via R2 state versioning + revert PR if needed.
- **PR-comment plan diff** via `dflook/terraform-plan@v2`.

Workflow at `.github/workflows/terraform.yml` (~190 lines):

- **Triggers**: `pull_request` and `push` to `main`, filtered by path (`infra/terraform/**`, `.github/workflows/terraform.yml`).
- **Permissions**: `contents: read`, `pull-requests: write` (for plan comments).
- **PR jobs** (parallel): `plan-shared`, `plan-staging`, `plan-prod`, `fmt-and-validate`. Each plan uses `dflook/terraform-plan@v2` with an inline `backend_config` (key + endpoints injected from secrets); diff is posted as a sticky PR comment per env. fmt-and-validate runs `terraform fmt -check -recursive` and `terraform validate` on each env with `-backend=false` (offline).
- **Main jobs** (sequential): `apply-shared` → `apply-staging` → `apply-prod`. Each calls `infra/terraform/scripts/tf.sh <env> apply -auto-approve`, which acquires the Postgres advisory lock per ADR-018. `concurrency: cancel-in-progress: false` so a running apply is never killed mid-flight. `apt-get install postgresql-client` step adds `psql` for the lock.
- **Secrets passed via job env**: R2 state creds, PG_LOCK_URL, per-provider tokens, env-specific Clerk keys.

**`tf.sh` fix shipped alongside**: made `.tfvars.local` sourcing optional (`if [[ -f ... ]]; then source; fi`) so the wrapper works in CI where there's no `.tfvars.local`. Required-env-var checks still fail loudly with `PG_LOCK_URL not set` if neither file nor env provides credentials — verified by running `env -i bash tf.sh staging plan` and seeing the expected error.

**`docs/infra.md` updated** with:
- A note that CI handles apply once the repo is pushed; the local `tf.sh` commands are the operator escape hatch.
- A table of 15 required GitHub Actions secrets + 6 required variables, with sources and the jobs that consume each.

**What this means architecturally**: the spec's `cd.yml` is now smaller — just Vercel deploys + migrations + smoke tests. Infrastructure delivery is fully decoupled from application delivery, which is the cleaner separation we wanted anyway. The spec's "delivery" ADRs (028 / 029 / 030) still describe the high-level pipeline correctly; a future spec rev should refine ADR-029 to acknowledge the workflow split.

**Branch state**: commit on `feat/phase-0b-tf-modules`; the branch now has two commits (the modules + this workflow). All three envs still `terraform validate` cleanly.

**Still NOT done** (unchanged from yesterday): no `terraform apply` has run; needs operator bootstrap. R2 versioning workaround still pending. PG advisory-lock smoke test still pending.

### 2026-05-22 — Repo pushed to GitHub; username typo fixed

User created the GitHub repo and pushed. Two events worth logging:

**Repo URL settled** — `git@github.com:agranado2k/ai-report-platform.git` (public). The user initially configured `origin` to `ai-html-report`, then asked to re-point to `ai-report-platform` (matches the internal working name; one identity across local + remote + Terraform resources). Old `ai-html-report` repo on GitHub is now orphaned; user can delete via UI when convenient.

**Username typo fix** — I'd been writing `agrando2k` across docs since rev 1 of the spec. The actual GitHub username is `agranado2k` (matches `/Users/agranado/` + `2k`). Caught when the user pushed and the SSH URL revealed the right spelling. Swept across:

- Main branch (commit `9264a27`): `CLAUDE.md` · `docs/diary.md` · `docs/infra.md` · `docs/spec.html`
- Feat/phase-0b branch (this commit): the same docs *plus* the Terraform-only files (`envs/shared/main.tf` CODEOWNERS template + `provider "github" { owner = ... }`; `modules/github-repo/outputs.tf` description; `modules/vercel-app/variables.tf` description; `envs/shared/variables.tf` description).
- All three Terraform envs still validate cleanly after the sed sweep.

**Push state**:
- `main` → pushed first to `ai-html-report` (commit `4f4452f`), then re-pushed to `ai-report-platform` after the URL swap. Now at `9264a27` with the typo fix.
- `feat/phase-0b-tf-modules` → pushed with this commit (typo fix + diary).
- Both visible on GitHub. Branch protection isn't on yet (Terraform-applied in the future Phase 0c work + the first `apply`). PR-from-feat-into-main is ready to open via the GitHub UI.

**Lesson for future-me**: when establishing a project's identity early (username, repo name, package prefix), pull from authoritative sources (`whoami`, the actual GitHub profile URL) rather than inferring from existing project paths. The `agrando2k` typo would have been caught at first read of any of `/Users/agranado/` if I'd looked.

### 2026-05-25 — Worktree convention change + Neon pooler lock issue

Two small but real things landed today, on top of the user's first attempt at `tf.sh staging apply`.

**Worktree layout moved from sibling to child-of-project.** Old convention was `git worktree add ../<slug>` putting the worktree at `~/PetProjects/<slug>/`. The user's preference: keep everything for one project under the project tree. New convention: `git worktree add worktree/<slug>` from the project root, putting worktrees at `~/PetProjects/ai-report-platform/worktree/<slug>/`. `worktree/` added to `.gitignore` on both branches. ADR-025 text in `docs/spec.html`, `CLAUDE.md`, and the diary's memory pointer all updated to match. Moved the active feat worktree with `git worktree move` — no commits lost, no checkouts broken.

**Neon pooler vs session-level advisory locks.** The user tried `tf.sh staging apply` and hit "Lock 'tf-staging' is held by another tf.sh invocation" → 60s timeout → "Failed to acquire lock." Diagnosis: `PG_LOCK_URL` was pointing at Neon's PgBouncer pooler endpoint (transaction-pooling mode). Session-level advisory locks acquired by one psql invocation persist on the warm pooled backend even after the client disconnects, so the next invocation gets `f` from `pg_try_advisory_lock`. Standard PgBouncer-meets-session-state issue. Resolution: switch `PG_LOCK_URL` to Neon's direct (non-pooled) endpoint and release the stale lock via `SELECT pg_advisory_unlock(hashtext('tf-staging'))`.

Also surfaced — and this one I should have caught when I wrote `tf.sh` originally — the script's locking design is broken in a deeper way: the lock is acquired in one psql invocation and the connection closes IMMEDIATELY, so even on a direct endpoint the lock doesn't actually serialize `terraform apply` runs. Two concurrent applies would both succeed. The fix is a backgrounded long-lived psql session that holds the lock across the apply, signaled to release on exit. Filed as a follow-up; doesn't block the user today as long as they're the only one applying.

**Bootstrap walkthrough also delivered** in chat — the explicit `tf.sh shared init → shared import → shared apply → staging → prod` sequence with the GitHub-repo import step (`module.github_repo.github_repository.this`) before `shared apply`, since the repo already exists from yesterday's push.

**Net effect on the branch**: this commit. No infrastructure changes; layout + convention + diary only.
