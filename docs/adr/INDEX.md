# Architecture Decision Records

Each ADR captures one architectural decision in [MADR format](https://adr.github.io/madr/). The record is the contract; the development chronology lives in `docs/diary.md`.

## Index

| # | Title | Status |
|---|---|---|
| 0008 | [Hashed, prefixed, user-scoped API keys](0008-api-key-authentication.md) | Accepted (2026-06-19) — extracted from spec; amends hashing/prefix |
| 0016 | [API-key scopes (+ anomaly detection, deferred)](0016-api-key-scopes.md) | Accepted (2026-06-19) — extracted from spec |
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
| 0047 | [Per-PR preview data isolation (soft) — ephemeral Neon branch + R2 key prefix](0047-preview-data-isolation.md) | Accepted (2026-06-15) — the soft-fallback residual gated by a `/health` readiness check, amended 2026-07-09 (issue #149) |
| 0048 | [Auth provisioning & integration model (Clerk JIT personal-org)](0048-auth-provisioning-model.md) | Accepted (2026-06-16) |
| 0049 | [Clerk dev/prod instance separation & the data-orphaning incident](0049-clerk-instance-hygiene.md) | Accepted (2026-06-18) |
| 0050 | [App design system — Tailwind v4 + CSS-first design tokens](0050-app-design-system-tailwind-v4-tokens.md) | Accepted (2026-06-19) |
| 0051 | [Remote MCP server — stateless Streamable HTTP, thin client over /api/v1](0051-mcp-server.md) | Accepted (2026-06-22) — refines ADR-003 |
| 0052 | [Stripe-style prefixed external IDs + third-party ID segregation](0052-external-id-scheme.md) | Accepted (2026-06-22) |
| 0053 | [Full Stripe-style API conventions — object/list envelopes, cursor pagination, mode + Request-Id](0053-api-payload-shape.md) | Accepted (2026-06-23, amended same day: livemode→mode) |
| 0054 | [User soft-delete via the Clerk user.deleted webhook (terminal, API-key revoke cascade)](0054-user-soft-delete.md) | Accepted (2026-06-23) |
| 0055 | [OpenTelemetry observability — three pillars to Grafana Cloud](0055-opentelemetry-observability.md) | Accepted (2026-06-23) — amends ADR-0053 §5 |
| 0056 | [Report sharing & ACLs — app-authorized, viewer-verified access tokens](0056-report-sharing-acls.md) | Accepted (2026-06-24) — extends ADR-0038; "owner = any org member" amended by 0059; P4/P5 collaborators superseded by 0060 |
| 0057 | [Transactional email via Resend (the allowlist magic link)](0057-transactional-email-resend.md) | Accepted (2026-06-26) — supports ADR-0056 |
| 0058 | ["Forge & Ember" warm-dark design system](0058-forge-and-ember-design-system.md) | Accepted (2026-06-29) — amends ADR-0050 |
| 0059 | [Per-user report ownership — the creator is the owner](0059-per-user-report-ownership.md) | Accepted (2026-07-06) — amends ADR-0056 |
| 0060 | [Per-report write grants — supersedes folder collaborators](0060-per-report-write-grants.md) | Accepted (2026-07-06) — supersedes ADR-009 + ADR-0056 P4/P5 |
| 0061 | [Organization types & membership — personal and team orgs](0061-organization-types-and-membership.md) | Accepted (2026-07-06) — activates ADR-005; requires 0059 first; deferred decisions resolved + membership model amended by 0068 |
| 0062 | [Editing model & "Report HTML" schema](0062-editing-model-report-html-schema.md) | Accepted (2026-07-07) — ratifies the PR #144 spike verdict |
| 0063 | [In-viewer editing on the viewer origin](0063-in-viewer-editing.md) | Accepted (2026-07-07) — amends ADR-0038, implementation gated on security review |
| 0064 | [Comments & annotations](0064-comments-annotations.md) | Accepted (2026-07-07) — new Authoring & Collaboration bounded context |
| 0065 | [ReportVersion history & visual diff](0065-version-history-visual-diff.md) | Accepted (2026-07-07) — builds on ADR-0062 |
| 0066 | [AI suggestion mode](0066-ai-suggestions.md) | Proposed — deferred (AI suggestion mode) |
| 0067 | [Live co-editing](0067-live-collaboration.md) | Proposed — deferred (live co-editing) |
| 0068 | [Domain-keyed single-org membership — the G4 scope decisions](0068-domain-keyed-single-org-membership.md) | Accepted (2026-07-08) — resolves + amends ADR-0061; defers ownership transfer |
| 0069 | [Development-agent trust boundary — compartmentalizing untrusted content from private data and external actions](0069-agent-tool-trust-boundary.md) | Accepted (2026-07-08) — applies ADR-0045/0062's isolation principle to Claude Code dev-agent tooling |
| 0070 | [Audit log write seam — the `AuditLogger` port, mirroring the transactional outbox](0070-audit-log-write-seam.md) | Accepted (2026-07-09) — mirrors ADR-0021's outbox shape; wires all 16 user-initiated, org-scoped mutating use cases (issue #153) |
| 0071 | [Extract shared `packages/ui` + `packages/editor`](0071-extract-ui-editor-packages.md) | Accepted (2026-07-10) — pure refactor; single source of truth for `iframe-document.ts`'s CSP ahead of ADR-0063's `apps/view` editor |

## Backlog (ADRs 1–30 from the spec)

The 30 foundational ADRs (ADR-001 through ADR-030) live inside `docs/spec.html` (rev 7) and have not yet been extracted into individual files in this directory. Tracked as a housekeeping follow-up. **Extracted so far** (on first implementation): ADR-0008, ADR-0016 (both 2026-06-19) — now standalone files in the table above; ADR-0008 also amends the spec's original hashing/prefix scheme. **Superseded in place**: ADR-009 (folder-inherited write grants) is superseded by ADR-0060 — the spec carries the supersession note at its next revision.

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
