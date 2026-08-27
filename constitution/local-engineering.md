# Local engineering — this stack's style, architecture, and boundaries

Project-specific elaboration of the root `CLAUDE.md`. Read it before writing code in
`packages/`, before touching `infra/`, and before adding any dependency. The portable
reasoning behind several of these rules lives in `shared-invariants.md`.

## Style

- **Functional, immutable** for `packages/domain/` and `packages/application/` (ADR-024).
  No new FP libraries — vanilla TS plus the `Result<T, E>` type with `ok`/`err`. The
  unused `pipe()` and the `Result` combinators were pruned by ADR-0073; ADR-024's
  no-FP-library decision stands.
- **`readonly` on every domain type.** ESLint fails the build otherwise.
- **No side effects in domain code** — push all I/O out to `packages/adapters/`.
- **Repository pattern** for data access (ADR-020). Drizzle implementations live in
  adapters, never in use cases.

## Domain-Driven Design (ADR-0036)

- **Four bounded contexts**: Reports & Folders / Identity & Access / Abuse & Moderation /
  Authoring & Collaboration (the fourth added by ADR-0064).
- **Aggregates** have exactly one root entity; **Value Objects** carry branded types;
  **Domain Events** are emitted at aggregate boundaries.
- **Use the glossary names everywhere** — code, tests, commits, PR titles, ADRs. The
  registry is `docs/domain-glossary.md`. Introducing a new term means adding it to the
  glossary **in the same PR**; the docs gate enforces the banned-alias list.
- **Cross-context integration goes through events.** The only shared kernel types are
  `UserId` and `OrgId`. The integration map is `docs/context-map.md`.
- **Do NOT adopt CQRS or Event Sourcing** — explicit non-goals in ADR-0036.

Package-scoped purity rules for the domain layer live in `packages/domain/CLAUDE.md`.

## Infrastructure

- **Everything-as-code** (ADR-017). No clicking in dashboards, with two documented
  exceptions: the one-time bootstrap R2 bucket and per-provider PATs. See `docs/infra.md`.
- **All `terraform` invocations go through `infra/terraform/scripts/tf.sh`** (ADR-018).
  The wrapper takes a Postgres advisory lock on Neon so two parallel applies cannot
  corrupt state. There is no supported path around it.
- **Infrastructure-first delivery** (ADR-019): every PR runs against real infrastructure.
  No mocks for external services in e2e tests.

## Test tiers

- Pure logic → `pnpm test` (vitest, `*.test.ts` co-located with source).
- Mounted-editor / real-browser behaviour → `pnpm test:browser`, the hermetic Chromium
  tier in `tests/browser/` (ADR-0079). It is a fast signal, **not** a merge gate.
- Anything needing a deployment → `pnpm e2e`.
- The docs gate's own validators → `pnpm docs:check:test` (node:test, fixture trees under a
  temp root). A first-class tier, not a side one: `.husky/pre-push`'s TDD pairing guard
  counts `scripts/docs-conformance/` as source, so a validator change with no fixture test
  is blocked exactly like a `src/` change would be; CI re-runs it in
  `.github/workflows/docs-conformance.yml`.

**Measuring a tier is not a tier** (ADR-0081). Mutation testing asks whether the first
bullet's tests are load-bearing, and it runs on demand, never on push: `pnpm test:mutation`
for the whole `arp-domain` calibration (~1050 mutants, ~51 s), `scripts/mutation-delta.sh`
for the differential form a review can afford — Stryker scoped to the pure-domain source
files the branch changed, printing the score and every surviving mutant with `file:line`.
It is a diagnostic and exits 0 whatever the score; `/review-pr`'s Agent 6 cites its
survivors instead of offering an opinion, and Agent 7's confirm-list carries its 🧬 line.
On a **stacked** branch pass the real base explicitly (`scripts/mutation-delta.sh
<base-branch>`): the `origin/main` default scopes the run to everything since main,
so the mutants of the branch underneath are attributed to this one.

Conventions and the red-green-refactor procedure itself live in `.claude/skills/tdd/SKILL.md` —
that skill is the single home for them, not this file.

## Boundaries — what this repo is NOT

- **Not a Bash playground for `curl | bash` shenanigans.** Never fetch and execute remote
  code. (The root states this as a hard rule; it is repeated here only as the boundary
  list's first member.)
- **Not a place to add runtime dependencies casually.** Every new dependency goes through
  PR review (Claude + Gemini, plus the operator's own read-through) and may require an
  ADR — especially for the domain and application layers, which are dependency-locked.
- **Not a place to bypass branch protection.** `PUSH_WITHOUT_DOCS=1` and
  `PUSH_WITHOUT_TESTS=1` are the only escape hatches for `.husky/pre-push`, and both print
  a loud warning into the push output. Neither ends the matter: CI re-runs the **docs**
  gate (`docs-conformance.yml`) and, since issue #280, the **TDD pairing** gate
  (`tdd-pairing.yml`, the same `scripts/tdd-pairing-guard.sh` over the PR's merge-base
  range), so a local bypass only defers the failure to the PR. Getting past the CI half
  takes the `tdd-exempt` PR label, which turns the job green with a `::notice::` naming
  the PR — a bypass anyone reviewing the PR can see, unlike an env var in a shell.
  It still rests on the operator's judgment; it just no longer rests on it invisibly.
- **Not a place to auto-trust MCP servers.** The rule is in the root's trust-boundary
  paragraph, where the rest of the ADR-0069 obligations live; it is named here only as a
  boundary-list member. None exists today.
