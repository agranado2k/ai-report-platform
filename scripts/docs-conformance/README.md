# docs-conformance

A dependency-free harness that confirms the spec, ADRs, glossary, events doc,
BDD `.feature` corpus, and OpenAPI document are **well-formed and mutually
consistent**. It implements the CI-enforced slice of the documentation-as-contract
policy (ADR-026) per ADR-0041; the PRD is GitHub issue #13.

## Run

```bash
pnpm docs:check        # run every validator against the repo; exit 1 on any violation
pnpm docs:check:test   # run the harness's own fixture tests (node:test)
```

`pnpm docs:check` is the single gate run by `.github/workflows/docs-conformance.yml`.

## How it's built

- **Plain ESM** (`.mjs`), Node built-ins only — no test runner, no lint deps.
- Each **validator** in `validators/` exports `{ id, run(ctx) }` and returns a
  list of `{ validator, file, rule, message, hint }` violations. It owns no
  policy — all rules live in `config.mjs`, so the rules are reviewable in a PR.
- `context.mjs` builds the read-only `ctx` (rooted at a repo path, so tests
  point it at fixture trees); `runner.mjs` aggregates; `index.mjs` is the CLI.
- Tests in `test/` are fixture-driven: a clean fixture passes, targeted dirty
  fixtures each fail with the expected rule.

## Validators

| id | checks |
|---|---|
| `adr-madr` | each ADR has the MADR sections, an allowed `**Status**`, a conformant filename |
| `adr-index-sync` | bijection between ADR files and `INDEX.md` rows |
| `glossary-terms` | banned aliases (e.g. bare "Version" → `ReportVersion`) across docs |
| `event-names` | every canonical event appears in `events.md` and the glossary |
| `feature-presence` | bijection between the use-case catalog and `.feature` files |
| `gherkin-structure` | each `.feature` has Feature + Scenario + exactly one known phase tag |
| `openapi-structure` | `openapi.yaml` exists and carries the required contract tokens |

## Adding a use-case

1. Add a slug → `{ title, phase, status }` entry to `config.features`.
2. Create `tests/e2e/features/<slug>.feature` with a phase tag, `Feature:`, and
   at least one `Scenario:`.

## Deferred (noted for a follow-up)

Full markdown lint, link-integrity, and Spectral/Redocly OpenAPI schema
validation are intentionally out of scope here (lint-lite token checks stand in
for the last). The local pre-push hook from ADR-026 is also deferred — CI is the
single seam (ADR-0041).
