# ai-report-platform

> A SaaS platform where LLMs push HTML reports to a user's account via API/MCP, the user gets a permanent shareable URL, and re-uploads update the live version without breaking links.

**Status:** Phase 0a — Terraform state bootstrap.

## Where things live

| Path                              | Purpose                                                  |
| --------------------------------- | -------------------------------------------------------- |
| `docs/spec.html`                  | Full v1 technical specification (rev 7, 30 ADRs)         |
| `docs/infra.md`                   | Bootstrap runbook — provision a fresh environment        |
| `docs/ops.md`                     | Operations runbook (added in Phase 0b)                   |
| `docs/adr/`                       | Architectural Decision Records (added in Phase 0b)       |
| `infra/terraform/`                | All long-lived infrastructure as code (ADR-017, 018, 019) |
| `apps/`                           | `apps/app` + `apps/view` Remix apps (Phase 0c)           |
| `packages/`                       | `domain` · `application` · `adapters` · `db` · etc. (Phase 0c) |
| `tests/e2e/infrastructure/`       | 13 Gherkin features gating Phase 1 (Phase 0d)            |
| `tests/e2e/features/`             | Use-case features, written `@pending` (Phase 0d)         |
| `.claude/`                        | Skills + hooks for TDD / docs / worktrees (Phase 0e)     |

## Phase 0 — what's in this commit (0a)

This seed commit ships the Terraform state bootstrap only. Nothing is provisioned yet beyond the bootstrap R2 state bucket (created manually in the Cloudflare dashboard per `docs/infra.md`).

Files added:

- `infra/terraform/backend.tf` — S3-on-R2 backend (partial; key + endpoints injected by `tf.sh`)
- `infra/terraform/scripts/tf.sh` — wrapper that acquires a Postgres advisory lock on Neon before `plan|apply`
- `infra/terraform/.tfvars.local.example` — template for bootstrap credentials (gitignored copy)
- `docs/infra.md` — operator runbook (accounts → state bucket → first `tf.sh init` → first `apply`)

## What's next

| Sub-phase | Deliverable                                                  | Gates    |
| --------- | ------------------------------------------------------------ | -------- |
| **0b**    | Terraform modules + `apply shared → staging → prod`          | Phase 0c |
| **0c**    | Skeleton Remix apps + CI/CD pipeline + AI review workflows   | Phase 0d |
| **0d**    | 13 infrastructure E2E features green; use-case features pending | Phase 1  |
| **0e**    | TDD / BDD / FP lint / worktree skill / docs gate / Bruno     | Phase 1  |
| **1+**    | Feature work — see `docs/spec.html`                          | —        |

## Conventions

- **All work in feature worktrees** (ADR-025): `git worktree add ../<slug> -b <type>/<slug>`.
- **Never push directly to `main`** — branch protection (Terraform-applied in Phase 0c) will block it.
- **PR-only delivery** with signed commits + linear history. Human approval is currently 0 (solo-developer branch-protection policy); AI review (Claude + Gemini) + CI status checks are the gates.
- **Branch naming**: `feat/` `fix/` `refactor/` `chore/` `docs/`.

See `CLAUDE.md` for the full agent operating manual.

## License

TBD — to be decided before the repo goes public.
