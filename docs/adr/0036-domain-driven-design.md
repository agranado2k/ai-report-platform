# ADR-0036: Adopt Domain-Driven Design principles

- **Status**: Accepted
- **Date**: 2026-06-04
- **Deciders**: agranado2k
- **Supersedes / amends**: complements ADR-020 (hexagonal architecture) and ADR-024 (vanilla TS, no fp-ts) — both stay in force.
- **Superseded by**: —

## Context and problem statement

ADR-020 commits to a hexagonal layout (`packages/domain/`, `packages/application/`, `packages/adapters/`) and ADR-024 to a vanilla-TS functional style with readonly domain types. Those decisions cover **how the domain layer is built**. They don't cover **how we model the domain** — what names we use, where one piece of business logic ends and another begins, and how cross-cutting concerns flow between subsystems.

Without an explicit modeling discipline, the in-progress `packages/domain/` work risks vocabulary drift between code, the spec, ADRs, and PR descriptions. The spec's three data partitions (Reports / Identity / Abuse) could be expressed in code in many ways; choosing one approach explicitly avoids debate per-PR.

Reference: [Domain-Driven Design — Martin Fowler](https://martinfowler.com/bliki/DomainDrivenDesign.html).

## Decision drivers

- A shared vocabulary that holds across code, docs, commit messages, PR titles, and conversations with stakeholders.
- Clear boundaries between subsystems so cross-cutting changes don't ripple silently.
- Testability — aggregate invariants must be unit-testable without I/O (already required by ADR-020 + ADR-024).
- Don't over-engineer; adopt only the DDD patterns that pay back at our scale (single SaaS product, three bounded contexts, no projected need for CQRS or Event Sourcing in v1).

## Considered options

1. **Adopt DDD strategic + a tactical subset (chosen)** — Commit to Ubiquitous Language, Bounded Contexts, and Context Map at the strategic level; Entities, Value Objects, Aggregates, Repositories, and Domain Events at the tactical level. Skip CQRS and Event Sourcing.
2. **No explicit modeling framework** — Let each feature define its own vocabulary and boundaries. Cheaper up front; pays back as drift and rewrites later.
3. **Full DDD (strategic + complete tactical patterns + CQRS + Event Sourcing)** — More patterns to teach the agent and the future contributors; most patterns offer no marginal value at our v1 scale.

## Decision outcome

**Chosen: Option 1.** Adopt DDD as the modeling discipline for `packages/domain/` and `packages/application/`.

### Strategic patterns (commit to all three)

- **Ubiquitous Language.** Domain terms (slug, report, version, folder, ACL, scan-status, abuse-report, takedown, etc.) are defined once and used consistently across code, docs, commit messages, PR titles, and inter-team conversations. The registry lives at `docs/domain-glossary.md`. New terms are added in the same PR that introduces them.
- **Bounded Contexts.** Three explicit contexts mirroring the spec's data model partition:
  - **Reports & Folders** — uploads, slugs, versions, folder tree, ACL.
  - **Identity & Access** — users, orgs, API keys, folder collaborators.
  - **Abuse & Moderation** — scan status, abuse reports, takedowns, CSP reports.
  Each context owns its tables and exposes events for cross-context communication.
- **Context Map.** Documented at `docs/context-map.md`. Notes how the three contexts integrate: shared kernel for identity primitives (`UserId`, `OrgId`), event-based communication for everything else, anti-corruption layers where a context needs to consume external models.

### Tactical patterns (adopt these)

- **Entities** — types with identity that change over time (e.g., `Report`, `Folder`, `Org`). Equality by ID, not by attributes.
- **Value Objects** — immutable types defined by their attributes (e.g., `Slug`, `PlanLimits`, `AclMode`, `Scopes`). Equality by value. Use branded TS types per the spec's `packages/domain/src/fp/branded.ts`.
- **Aggregates** — invariant boundaries. Each aggregate has one root entity; external code can only reference the root. Examples: `Report` aggregate contains `ReportVersion`s and the `Acl`; `Folder` aggregate contains its `Collaborator`s. Defined explicitly per context.
- **Repositories** — already covered by ADR-020 (interfaces in `packages/application/`, Drizzle implementations in `packages/adapters/`). One repository per aggregate root.
- **Domain Events** — emitted by aggregates on state changes (e.g., `ReportPublished`, `VersionScanned`, `AbuseReported`). Carried via the transactional outbox that the spec's event-driven decision already commits to.

### Explicitly NOT adopting

- **CQRS** — Premature for v1. Revisit if read and write paths diverge enough to warrant separate models.
- **Event Sourcing** — Postgres rows are the source of truth for current state. The outbox is for inter-context messaging, not history reconstruction.
- **Aggregate-per-table fundamentalism** — Pragmatic boundaries, not religion. A read-path query joining tables across two aggregates is fine inside an adapter; the *write* path is what aggregate boundaries protect.

### Consequences

**Positive**

- Vocabulary alignment: PR titles, ADRs, commit messages, code, and `docs/spec.html` use the same nouns.
- Clean integration points: cross-context calls go through events or explicit ACLs, never through shared mutable state.
- Tests on aggregates run without I/O (compatible with ADR-024).

**Negative**

- Naming and boundary debate up front. Mitigated by writing the glossary now and treating it as the contract.
- Risk of over-engineering small features. Mitigated by the "Explicitly NOT adopting" list and the rule that new patterns require their own ADR before adoption.

**Neutral**

- ADR-020's file layout already supports this. This ADR formalizes intent rather than mandating new structure.

## Pros and cons of the options

### Option 1 — Adopt DDD strategic + a tactical subset *(chosen)*

- Pro: Shared vocabulary and bounded contexts pay back immediately, even before the first feature lands.
- Pro: All tactical patterns adopted (Entity, Value Object, Aggregate, Repository, Domain Event) align with existing ADRs.
- Con: Up-front investment in glossary and context map. Small (one PR).

### Option 2 — No explicit modeling framework

- Pro: Zero up-front cost.
- Con: Vocabulary and boundaries get decided per-PR. Inconsistency compounds. Risk of having to rewrite domain code as conventions emerge.

### Option 3 — Full DDD (with CQRS + Event Sourcing)

- Pro: Maximal pattern coverage if the project grows.
- Con: Two additional architectures (separate read/write models, event-sourced state reconstruction) that solve problems we don't have. Costs an order of magnitude more than what we get back at v1.

## More information

- [Domain-Driven Design — Martin Fowler](https://martinfowler.com/bliki/DomainDrivenDesign.html) (the bliki page the operator referenced).
- Eric Evans, *Domain-Driven Design: Tackling Complexity in the Heart of Software* (2003) — the source for the tactical patterns this ADR adopts.
- Bounded contexts and the spec's data partition are described in `docs/spec.html` (rev 7) — see the Architecture section.
- `docs/domain-glossary.md` — registry of Ubiquitous Language terms.
- `docs/context-map.md` — integration map between the three bounded contexts.
- Adjacent ADRs: ADR-020 (hexagonal layout), ADR-024 (vanilla TS / functional style).
