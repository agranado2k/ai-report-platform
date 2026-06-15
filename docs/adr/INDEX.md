# Architecture Decision Records

Each ADR captures one architectural decision in [MADR format](https://adr.github.io/madr/). The record is the contract; the development chronology lives in `docs/diary.md`.

## Index

| # | Title | Status |
|---|---|---|
| 0035 | [Bot-merge workflow for signed-commits + rebase-merge](0035-bot-merge-workflow.md) | Superseded by 0044 (2026-06-09) |
| 0036 | [Adopt Domain-Driven Design principles](0036-domain-driven-design.md) | Accepted (2026-06-04) |
| 0037 | [Report upload & versioning pipeline](0037-report-upload-versioning-pipeline.md) | Accepted (2026-06-04) |
| 0038 | [Report viewer access & serving model](0038-report-viewer-access-serving.md) | Accepted (2026-06-04) |
| 0039 | [Idempotent write API](0039-idempotent-write-api.md) | Accepted (2026-06-04) |
| 0040 | [HTTP API error model (RFC 9457)](0040-http-api-error-model.md) | Accepted (2026-06-04) |
| 0041 | [Documentation-as-contract — CI-enforced conformance harness](0041-docs-conformance-ci-harness.md) | Accepted (2026-06-04) |
| 0042 | [Adopt Vitest as the unit/integration test runner](0042-adopt-vitest-test-runner.md) | Accepted (2026-06-04) |
| 0043 | [Validate environment variables with Zod + @t3-oss/env-core](0043-zod-env-validation.md) | Accepted (2026-06-04) |
| 0044 | [Signed merge commits instead of rebase-merge + bot-merge](0044-merge-commit-strategy.md) | Accepted (2026-06-09) |
| 0045 | [Async content-scan pipeline (pg-boss on Neon, Cloudflare cron)](0045-async-content-scan-pipeline.md) | Accepted (2026-06-11) |
| 0046 | [Two-tier adapter testing — in-process pglite below the Neon e2e tier](0046-adapter-sql-test-tier.md) | Accepted (2026-06-15) |

## Backlog (ADRs 1–30 from the spec)

The 30 foundational ADRs (ADR-001 through ADR-030) live inside `docs/spec.html` (rev 7) and have not yet been extracted into individual files in this directory. Tracked as a housekeeping follow-up.

## Decisions recorded in the development diary (not ADRs)

Several material decisions made during Phase 0c iteration are recorded as dated entries in `docs/diary.md` — they describe what was decided and why, but did not warrant a standalone ADR file at the time. They are still binding policy. If any of them grow consequential enough to deserve formal ADR treatment, a new ADR file lands here and the diary entry gets a back-reference.

- **2026-06-02** — Drop persistent staging; continuous deployment to prod.
- **2026-06-02** — Solo-developer branch protection policy (`required_approving_review_count = 0`).
- **2026-06-02** — Conventional Commits + semantic-release + rebase-merge convention.
- **2026-06-03** — GitHub Merge Queue setup attempted and rejected (user-owned repositories cannot enable it).

## Conventions

- File name: `NNNN-short-kebab-title.md`. Zero-padded to four digits.
- Status values: `Proposed | Accepted | Rejected | Deprecated | Superseded by NNNN`.
- The "Decision" section is the contract. Implementation detail and historical context go in `More Information` at the bottom, kept short.
- When a decision is reversed or revised, do NOT edit the old ADR — write a new one and set the old one's status to `Superseded by NNNN`.
- The diary references the ADR by number; the ADR does not reference the diary.
