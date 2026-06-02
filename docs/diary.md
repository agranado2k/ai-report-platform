# Development diary

> Living history of the `ai-report-platform` build. The **Current state** block at the top is the agent re-orientation summary — read it first when picking up the project. Below it: forward-chronological entries, newest at the bottom.

---

## Current state — 2026-06-02

| Field                  | Value                                                                          |
| ---------------------- | ------------------------------------------------------------------------------ |
| **Phase**              | Phase 0c.2 merged at `c04de5c` (PR #3 — shared `arp-headers` package + Edge MW stubs). PR #4 in flight on `feat/phase-0c-commit-conventions`: Conventional Commits enforcement + semantic-release pipeline + rebase-merge revision (ADR-033) + Vercel Corepack env-var Terraform codification. Sub-PRs remaining after #4: 0c.3 CI/CD workflows, 0c.4 AI review bots, 0c.5 re-tighten branch protection. |
| **Repo path**          | `~/PetProjects/ai-report-platform/` (main) · `~/PetProjects/ai-report-platform/worktree/phase-0c-commit-conventions/` (active worktree). Old 0b / 0c.1 / 0c.2 worktrees cleaned up. |
| **Branch**             | `feat/phase-0c-commit-conventions` open against `main` (PR #4 — rebased on `c04de5c`) |
| **Last commit on main**        | `c04de5c` — `Phase 0c.2: shared arp-headers + Edge MW stubs (#3)` |
| **Remote**             | `git@github.com:agranado2k/ai-report-platform.git` (public). |
| **Live infrastructure**| **shared + prod applied.** Cloudflare zone (DNS + zone settings), R2 buckets (`tf-state`, `arp-reports-prod`, `arp-reports-ci`), Neon project (single `main` branch post-ADR-031), Upstash Redis (global mode), Clerk app, Vercel projects (`arp-app-prod` + `arp-view-prod`, both green on PRs #2 and #3), GitHub repo with ADR-032 branch protection (0 required approvals, still squash-merge until PR #4 applies). `ENABLE_EXPERIMENTAL_COREPACK=1` set manually for both PR #2 and PR #3 preview branches; PR #4 codifies it in `envs/prod/main.tf` so every future branch inherits it. |
| **Active worktrees**   | `feat/phase-0c-commit-conventions` at `~/PetProjects/ai-report-platform/worktree/phase-0c-commit-conventions/` |
| **Spec status**        | rev 7 · 33 ADRs (ADR-031 + ADR-032 + ADR-033 in diary; spec/HTML still on rev 7, sync deferred) · 13 infra + 31 feature verification tests · `docs/spec.html` |

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

### 2026-06-02 — ADR-031: continuous deployment to prod; persistent staging dropped

After applying shared, running staging through ~half a dozen real provider-quirk fixes (Neon org_id, Neon retention cap, Neon branch role inheritance, R2 location case, Upstash regional→global, Upstash free-tier limit, GitHub Variables permission), the user called the architectural question: **is persistent staging actually carrying its weight?**

Decision: **no.** Staging is removed. The platform deploys continuously to prod.

What we keep, what we drop:

- **Kept**: per-PR Vercel preview deploys (every PR gets `<sha>.vercel.app` URLs for app + view automatically), per-PR ephemeral Neon branches (CI provisions them via the Neon API; deleted on PR close), prefix-isolated R2 and Upstash for CI's test data (`pr-<N>/` keys + `pr-<N>:` namespaces).
- **Dropped**: persistent staging Vercel projects (`arp-app-staging`, `arp-view-staging`), staging R2 buckets (`arp-reports-staging`, `arp-reports-ci`), staging Upstash database (`arp-staging`), staging Clerk test instance (still exists in Clerk dashboard; Terraform just stops referencing it), the persistent `staging` branch on the Neon project (main = prod), staging DNS records (`staging.app.agranado.com` / `staging.view.agranado.com`), `envs/staging/` Terraform directory, `plan-staging` + `apply-staging` GHA jobs.

The architectural rationale: at solo + LLM-assisted scale, **the safety net staging used to provide is now provided by other layers** — Vercel previews surface UX/visual issues per-PR; ephemeral Neon branches catch migration breakage per-PR; AI review (Claude + Gemini) + human review catch code defects per-PR; and the production blast radius is bounded by the size of any single change. Persistent staging was costing real Upstash/Vercel quota and forcing a manual "promote to prod" decision that, in practice, was always going to be "yes" after CI green + Vercel preview looked right.

This is a deliberate revision of the spec's **ADR-019** (infrastructure-first delivery had shared → staging → prod) and **ADR-026/029** (CD pipeline ran apply-staging before apply-prod). The infrastructure-first principle stands — every PR still runs against real infrastructure, just not a persistent staging slice. The CD pipeline stays "PR → CI green → human + AI review → merge → auto-apply" but the apply chain shortens to `shared → prod`.

**Code changes landed in this commit:**
- Deleted `infra/terraform/envs/staging/` (composition + secrets template; the gitignored secrets.auto.tfvars went with it)
- Simplified `modules/neon-project/main.tf` — removed `neon_branch.staging` and `neon_endpoint.staging`; the project is now single-branch (main). Per-PR ephemeral branches still happen via the Neon API from CI.
- Trimmed `modules/neon-project/outputs.tf` — removed `staging_connection_uri`
- Trimmed `envs/shared/outputs.tf` — removed `neon_staging_connection_uri`
- Trimmed `envs/shared/main.tf` — removed the two staging DNS records from `local.app_view_records`
- Trimmed `.github/workflows/terraform.yml` — removed `plan-staging` and `apply-staging` jobs; updated header comments and the fmt-and-validate loop from `for env in shared staging prod` to `for env in shared prod`. Five jobs total now: plan-shared, plan-prod, apply-shared, apply-prod, fmt-and-validate.

**What this leaves for next apply (operator-side):**
- `tf.sh shared apply` will diff: destroy `neon_branch.staging`, `neon_endpoint.staging`, and the 2 staging DNS records — clean reconciliation between state and the new code. Probably "0 to add, 0 to change, 4 to destroy."
- `tf.sh prod apply` will then succeed for Upstash (slot freed by the staging destroy step + the now-removed staging Neon branch).

Spec/HTML carry the old shared→staging→prod model and will need a follow-up sync (Phase 0c-ish). The diary is the authoritative log for this decision until that sync happens.

### 2026-06-02 — Phase 0b merged · Phase 0c.1 starts: monorepo scaffold + skeleton Remix apps

**Phase 0b merged.** PR #1 (`feat/phase-0b-tf-modules` → `main`) squash-merged at `51b6186`. The merge surfaced a small divergence: local `main` had an unpushed `chore: worktrees live under worktree/` commit (`8e24da7`) whose contents were already inside the squash. Resolved by `git reset --hard origin/main` on both local `main` and the new feat branch. No work lost — the worktree-convention chore is reflected in the squash and in the diary's ADR-025 entries.

**Phase 0c plan (five sub-PRs, kept small to stay merge-ready):**

| # | What | Why this unit |
|---|---|---|
| 0c.1 (this) | Monorepo scaffold (`pnpm-workspace.yaml`, `turbo.json`, root tsconfig) + skeleton `apps/app` + skeleton `apps/view` with `/` and `/health` routes. Both apps are Remix v2 + Vite + `@vercel/remix` Vercel preset. | Unblocks the three Vercel deploy checks that have been failing on every Phase 0b push because Vercel had no `package.json` to detect. |
| 0c.2 | `packages/headers/` shared `secureHeaders()` emitting the full ADR-013 stack + Edge Middleware stubs (rate-limit, `Service-Worker: script` → 403, scan-status precheck). | Lands the security baseline as a single source of truth before any route uses it. |
| 0c.3 | `.github/workflows/ci.yml` (biome + typecheck + vitest + Playwright + Bruno) and `cd.yml` (post-merge prod deploy + smoke). | The required-status-checks list in 0c.5 needs these jobs to exist first. |
| 0c.4 | `claude-review.yml` + `gemini-review.yml` AI PR-review bots (ADR-030). | Independent of 0c.3 once `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` are in repo secrets (both already populated by Terraform). |
| 0c.5 | Re-tighten branch protection: re-enable "Include administrators" and populate `required_status_checks` with the actually-running job names from 0c.3 + 0c.4. Terraform change in `modules/github-repo/`. | Closes the loop: branch protection is now PR-only AND status-checked. |

Each PR is intended to be small enough to review in one sitting and to deploy on its own — no "0c.1 only works once 0c.3 lands" coupling.

**What landed in this commit (0c.1):**

- Root `package.json` (workspaces, scripts via Turbo, pnpm 9, Node ≥20)
- `pnpm-workspace.yaml` (covers `apps/*` and `packages/*`)
- `turbo.json` (build, dev, typecheck, clean tasks; build outputs include `.vercel/output/**`)
- Root `tsconfig.json` — strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, ES2022/ESNext modules
- `apps/app/` — Remix v2 + Vite + Vercel preset; `app/root.tsx`, `app/routes/_index.tsx`, `app/routes/health.tsx` (returns service + checks + timestamp JSON, `cache-control: no-store`)
- `apps/view/` — same shape as `apps/app` on port 3001; placeholder `_index.tsx` calls out viewer-origin role, `health.tsx` same payload shape
- `.gitignore` — added `.vite/` + `**/.cache/` (rest of the Node/Turbo/Vercel patterns were already there from Phase 0b)

**What's deliberately NOT in this commit:**

- No `entry.client.tsx` / `entry.server.tsx` — the Remix Vite plugin auto-generates both. Less code to maintain unless we need to customize.
- No `$slug.$.tsx` viewer route yet — Phase 1 wires the real slug→version→R2 flow; for 0c.1 the `_index.tsx` is enough to prove Vercel deploys.
- No `vercel.json` per app — the existing `modules/vercel-app/` Terraform configured Root Directory per project; trusting that. If Vercel detection fails on this push, we add `vercel.json` in 0c.5 alongside the branch-protection re-tighten.
- No `packages/headers/` — that's 0c.2's whole point.
- No CI workflows — those are 0c.3.
- No Clerk / Neon / R2 / Upstash wiring inside `/health` — the route reports `"not-wired"` for each so it returns 200 and lets the Phase 0d infrastructure tests assert against a known shape. Phase 0c.2/0c.3 wires real checks.

**Open issue carried into next session**: clean up `worktree/phase-0b-tf-modules` (its branch is merged). Command: `git worktree remove worktree/phase-0b-tf-modules && git branch -D feat/phase-0b-tf-modules` from the project root.

### 2026-06-02 — ADR-032: solo-developer mode (no required human PR approval) + Vercel Corepack env-var hunt

Two changes appended to PR #2 after the green-build celebration.

**ADR-032 — solo-developer branch-protection mode.**

The Phase 0b branch protection (per the original ADR-025 ruleset) required `required_approving_review_count = 1` plus `require_code_owner_reviews = true`. With only one developer (`@agranado2k`) and CODEOWNERS pointing at the same single account, this was an unmergeable configuration — GitHub refuses to let you approve your own PR, so every merge would have been blocked. The Phase 0b PR squeaked through only because the protection rule wasn't applied to that repo state yet.

Decision: drop human approval to `0` and turn `require_code_owner_reviews` off. The PR mechanism stays (no direct pushes to main; signed commits + linear history + conversation resolution still required), and CI status checks + AI review (Claude + Gemini per ADR-030) remain the gates. CODEOWNERS becomes informational — useful to GitHub's UI as an ownership map but not a merge gate.

This is a deliberate revision of **ADR-025**. When a second developer joins, flip `required_approving_review_count` back to `1` and `require_code_owner_reviews` back to `true` in `infra/terraform/modules/github-repo/main.tf` — both are a single line each. Spec rev 7 still describes the multi-developer ruleset; the diary is the authoritative log for this decision until the spec sync (deferred along with the ADR-031 sync to a later Phase 0c/0d follow-up).

**Code changes landed in this commit:**

- `modules/github-repo/main.tf` — `required_approving_review_count = 0`, `require_code_owner_reviews = false`, comment block explaining the revert path
- `CLAUDE.md` — rewrote the "PRs receive automated review…" line to reflect ADR-032; rewrote the runtime-deps paragraph to drop the CODEOWNERS-review wording
- `README.md` — updated the "PR-only delivery" bullet for solo-mode

`enforce_admins`, `require_signed_commits`, `required_linear_history`, `allows_force_pushes = false`, `allows_deletions = false`, `required_conversation_resolution` — all unchanged. The owner still cannot bypass the PR mechanism.

**Vercel build saga (in-flight on this PR).**

The first three commits past the initial scaffold all hit Vercel build failures and cost real debugging time. Worth recording because the wrong fix is more likely than the right one on a Node-version/package-manager incompatibility:

1. `engines.pnpm: ">=9"` triggered `ERR_PNPM_UNSUPPORTED_ENGINE` because Vercel's image runs pnpm 6.35.1, which reads `engines.pnpm` and bails before install. Removed the field; added per-app `vercel.json` with `installCommand` running `corepack enable && corepack prepare pnpm@<version> --activate && pnpm install`.
2. With Corepack-installed pnpm 9.12.0 + Node 24 (Vercel's default), every npm registry fetch died with `ERR_INVALID_THIS: Value of "this" must be of type URLSearchParams`. I assumed this was the known pnpm/Node 22.12+ undici bug. Bumped to pnpm 9.15.4 — no fix.
3. Bumped to pnpm 10.5.0 — no fix.
4. **Actual root cause** (per [Jelani Harris's blog](https://jelaniharris.com/blog/fixing-errinvalidthis-error-on-vercel-using-pnpm/) + the Vercel community thread): Vercel's Corepack support is gated by the env var `ENABLE_EXPERIMENTAL_COREPACK=1` at the *project* level. Without it, the install command runs Corepack but Vercel's wrapper bypasses the prepared pnpm binary and falls back to a built-in that hits the Node 24 URL bug. Set via `vercel env add` on `arp-app-prod` + `arp-view-prod` (Production + this branch's Preview). Empty commit triggered a fresh deploy; both projects went green.

**Carry-over for Phase 0c.5** (Terraform re-tighten + codification pass): add `ENABLE_EXPERIMENTAL_COREPACK = "1"` to `modules/vercel-app/main.tf` as a `vercel_project_environment_variable` resource so future preview branches don't need manual CLI setup. Right now the env var is scoped to the `feat/phase-0c-skeleton-apps` branch only.

**Memory pointer (future-me)**: the wrong fix on a "build is broken on Vercel" symptom is to chase package manager versions. The right fix is usually a Vercel-project-level setting (env var, Node version, Root Directory). Read the actual Vercel docs and community thread before bumping versions speculatively.

<<<<<<< HEAD
### 2026-06-02 — Phase 0c.2: shared `arp-headers` package + Edge Middleware stubs

Phase 0c.1 merged at `2fa0d22`; both Phase 0b and 0c.1 worktrees cleaned up. Phase 0c.2 starts in `worktree/phase-0c-shared-headers/` on `feat/phase-0c-shared-headers`.

The goal of this slice: stand up the **single source of truth for security headers** (`packages/headers/`) so every route in both apps reaches it through the same function, and land the Edge Middleware skeletons so Phase 0d's infra tests have something concrete to assert against.

**`packages/headers/` — exposes two functions:**

| Function | Origin | Distinguishing pieces |
|---|---|---|
| `viewHeaders()` | `view.<domain>` | Full ADR-013 stack — two CSP headers (enforcing + `sandbox`), report-only shadow policy, COOP=`same-origin`, CORP=`same-site`, `Origin-Agent-Cluster`, `Referrer-Policy: no-referrer`, `Cache-Control: private, max-age=60, must-revalidate`. |
| `appHeaders()` | `app.<domain>` | Same baseline tightened where we control the content — no `'unsafe-inline'` in `script-src`, CORP=`same-origin` (tighter), `Referrer-Policy: strict-origin-when-cross-origin`, **Trusted Types** enforced (`Require-Trusted-Types-For: 'script'` + `Trusted-Types` allowlist), no default Cache-Control (loaders set their own). |

Both functions return a fresh `Headers` instance so callers can override per-response (e.g. `/health` overrides Cache-Control to `no-store`). Shared utilities (`PERMISSIONS_POLICY` denying ~13 sensors/APIs, `HSTS` with preload, `Report-To` builder) live in `src/permissions-policy.ts`. The `Report-To` endpoint resolves to `${APP_ORIGIN}/csp-report` at request time so prod / preview / local each get the right URL.

Package is `name: "arp-headers"` (unscoped, matches `arp-app` / `arp-view`), `private: true`, `type: "module"`, exports `./` `./view` `./app` directly from `src/*.ts` (no build step — both apps are Vite, which handles TS workspace deps natively).

**Edge Middleware stubs:**

- `apps/view/middleware.ts` — **ADR-014 lands here**: any GET carrying `Service-Worker: script` returns 403 with `x-edge-marker: view-mw-sw-blocked`. Other requests pass through `next()` with `x-edge-marker: view-mw` so Phase 0d's `edge-middleware.feature` test can assert the edge ran. Per-IP rate-limit + `scan_status` precheck are tagged `TODO Phase 1`.
- `apps/app/middleware.ts` — placeholder `next()` with `x-edge-marker: app-mw`. Signup/login rate-limit + Turnstile + CSRF tagged `TODO Phase 1`.

Both use `@vercel/edge`'s `next()` helper (added to each app's dependencies along with `arp-headers: workspace:*`).

**`/health` routes rewired:**

Both apps' `health.tsx` switched from `Response.json` to `new Response(JSON.stringify(...), { headers })` where `headers` comes from the shared package. They override `content-type` + `cache-control: no-store` on top of the baseline stack so the `/health` JSON is always fresh but every other ADR-013 header still ships. This is the canonical pattern future routes will follow.

**What's deliberately NOT in this commit:**

- No CSP nonces yet — `'unsafe-inline'` in viewer `script-src` is permitted (ADR-013) because users author the scripts. We add nonces to the dashboard when there's actual inline script to nonce in Phase 1+.
- No `/csp-report` endpoint — that's an `app.<domain>` route, lands in Phase 1 alongside the report ingestion table.
- No Upstash wiring in the middlewares — Phase 1's rate-limit slice.
- No unit tests yet — TDD scaffolding (`.claude/skills/tdd/SKILL.md` + hooks) is Phase 0e per ADR-022.

**Open question for review**: the dashboard's CSP `connect-src` currently allowlists `https://*.clerk.accounts.dev` and `https://clerk.accounts.dev` (Clerk's default token endpoint). Once the prod Clerk instance has its own subdomain on `clerk.<our-domain>`, we narrow this. Tracked for Phase 0c.5 alongside Terraform-codified branch protection.
=======
### 2026-06-02 — ADR-033: Conventional Commits + semantic-release

Two things needed for a clean release pipeline that's auditable across the team and across time:

1. **Commit-message format the team can parse** — humans and tools both. The Conventional Commits standard (`<type>(<scope>): <subject>`) is the de-facto choice, has tooling everywhere, and maps cleanly onto SemVer (`feat` → minor, `fix`/`perf` → patch, `BREAKING CHANGE:` → major).
2. **An automatic version + tag + release pipeline** so we never debate "what's in prod right now" — the answer is `v1.4.2` and the GitHub Release has the bullet list of what changed.

**Decision**: Adopt Conventional Commits across all commits and PR titles; use the `semantic-release` npm package on merge-to-`main` to compute the next version, write the git tag, and publish a GitHub Release with auto-generated notes. No npm publish (this isn't a distributed library); no in-repo `CHANGELOG.md` (GitHub Releases is the source of truth — see "branch-protection interaction" below).

**Why semantic-release and not Changesets** (the obvious alternative): we evaluated. Changesets is the better fit for libraries published to npm where per-package versioning matters. Our shape is a SaaS — single application, multiple internal packages — and the team's stated preference is commit-driven (one less file to remember when opening a PR). Diary entry stands as the comparison record so this isn't relitigated.

**Why no in-repo `CHANGELOG.md` + `@semantic-release/git` plugin**: those would push back to `main`, which under ADR-025 + ADR-032 still requires signed commits + linear history + no force-push. The GitHub Actions bot can't sign commits without extra secret machinery, and we're not adding that just to keep a markdown file. GitHub Releases gives the same audit trail without the push-to-protected-branch dance.

**Allowed commit types** (`@commitlint/config-conventional` defaults, mirrored in `commitlint.config.js`): `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`. Bump mapping in `.releaserc.json`:

| Type | Bump | Shows in release notes? |
|---|---|---|
| `feat` | minor | ✅ "Features" |
| `fix` | patch | ✅ "Bug Fixes" |
| `perf` | patch | ✅ "Performance" |
| `refactor` | none | ✅ "Refactoring" |
| `docs` | none | ✅ "Documentation" |
| `chore` / `test` / `ci` / `build` / `style` | none | hidden by default |
| `BREAKING CHANGE:` in body or `!` after type | major | ✅ "BREAKING CHANGES" |

**Enforcement (two layers)**:

1. **Local — `.husky/commit-msg`** runs `commitlint` on every commit. Bad message → rejected. Bypass with `--no-verify` exists for emergencies but is logged.
2. **CI — `.github/workflows/pr-title.yml`** lints the PR title via `amannn/action-semantic-pull-request@v5`. Because branch protection only allows squash-merge, the PR title becomes the commit on `main` — the title is what `semantic-release` actually parses. Linting it stops a Conventional-Commits-violating merge from breaking the release pipeline.

**Release workflow — `.github/workflows/release.yml`**: triggers on push to `main`, full git history checkout, Corepack-prepares pnpm 10.5.0, runs `pnpm exec semantic-release`. The Vercel-style `ENABLE_EXPERIMENTAL_COREPACK` dance isn't needed here — this is GitHub-hosted, not Vercel-hosted. `permissions.contents: write` lets the workflow create tags + releases without a PAT.

**Files landed in this commit:**

- `package.json` — added `prepare`, `commitlint`, `release`, `release:dry` scripts; 8 new devDependencies (commitlint, husky, semantic-release + 3 plugins, conventionalcommits preset)
- `commitlint.config.js` — extends `@commitlint/config-conventional`, relaxes `body-max-line-length` (we paste log excerpts in commit bodies regularly)
- `.husky/commit-msg` — runs `pnpm exec commitlint --edit "$1"`, executable bit set
- `.releaserc.json` — branches `main`, `tagFormat: v${version}`, the three-plugin pipeline (commit-analyzer → release-notes-generator → github) with the bump table above
- `.github/workflows/release.yml` — push-to-main trigger, concurrency-guarded, semantic-release run
- `.github/workflows/pr-title.yml` — lints PR titles with the same type allowlist
- `CLAUDE.md` — added rule #4 under "Before any change" with the commit-format rule + examples

**Carry-over to 0c.5**: `release.yml` and `pr-title.yml` should be added to `required_status_checks` in the `github_branch_protection` module so a Conventional-Commits-failing PR can't merge.

**Memory pointer**: zora-pantheon was the reference point for "find a release setup we've used before." Turned out it uses Changesets, not semantic-release; we adopted semantic-release anyway after weighing both. Don't conflate the two next time future-me hears "like the zora-pantheon setup."
>>>>>>> b5d44f6 (feat(release): Conventional Commits + semantic-release (ADR-033))
