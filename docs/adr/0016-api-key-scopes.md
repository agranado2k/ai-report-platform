# ADR-0016: API-key scopes (+ anomaly detection, deferred)

- **Status**: Accepted
- **Date**: 2026-06-19
- **Deciders**: agranado2k
- **Supersedes / amends**: extracts ADR-016 from `docs/spec.html` (rev 9) into a standalone record. Builds on ADR-0008 (API keys), ADR-0039 (the `reports:write` scope already enforced by the upload use case).
- **Superseded by**: —

## Context and problem statement

An API key (ADR-0008) must not be all-powerful: a key handed to an autonomous agent should grant only what that agent needs. The platform already has one scope in use — `reports:write`, checked inside `uploadReport` (`cmd.actor.scopes.includes("reports:write")` → `InsufficientScope` → HTTP 403). This ADR records the scope vocabulary and how it's enforced.

## Decision drivers

- **Least privilege**: a key handed to an autonomous agent should grant only what that agent needs (e.g. a read-only export key).
- **One enforcement path** for both auth schemes — a Clerk session and an API key both produce an `UploadActor`, so authorization shouldn't care which.
- Keep **403 (authenticated but not allowed) distinct from 401 (not authenticated)** per the error model (ADR-0040).

## Considered options

- **Where to enforce**: per-use-case `actor.scopes.includes(...)` checks (chosen — keeps authorization beside the mutation it guards) vs a central route-level scope registry (one place, but detached from the domain logic and easy to forget on a new route).
- **Anomaly detection**: ship geo/rate/failed-auth heuristics now vs **defer** (chosen — it depends on the rate-limiting layer + observability not yet in place, ADR-0011).

## Decision outcome

- **Scope vocabulary**: `reports:write`, `reports:read`, `folders:write`, `acl:write`. A key carries a subset in its `api_keys.scopes` JSON column; the Clerk-session path grants the full personal-org set (today: `reports:write`, ADR-0048/0039).
- **Enforcement at the use-case layer**, not the route: a use case that mutates checks `actor.scopes.includes(<scope>)` and returns `InsufficientScope` (→ 403 `forbidden`, ADR-0040) when missing. This keeps authorization with the domain logic, independent of the auth scheme (session or key) that produced the actor. `reports:write` is enforced today; `folders:write`/`acl:write` gates are wired as those mutations gain key access.
- **The actor's scopes are the source of truth.** `authenticateApiKey` (ADR-0008) copies `api_keys.scopes` onto the `UploadActor` verbatim — scopes are never hardcoded on the key path, so a least-privilege key (e.g. `reports:read` only) is honored end-to-end.

## Deferred

- **Anomaly detection** (geo / rate / failed-auth heuristics + admin alerts) from the spec's ADR-016 is **deferred** — it depends on the rate-limiting layer (ADR-0011, Phase 1.5) and observability not yet in place. `last_used_at` (ADR-0008) is the minimal usage signal for now.
- A **scope-picker UI** in `settings.api-keys`: the MVP mints keys with the default `reports:write`; granular scope selection lands when a second scope gains key-reachable mutations.

## Consequences

- **Good**: least-privilege keys; one enforcement mechanism for both auth schemes; 403 vs 401 correctly distinguishes "authenticated but not allowed" from "not authenticated" (ADR-0040).
- **Trade-offs**: scope checks are per-use-case (no central registry) — a new mutating endpoint must remember its `requireScope` check; covered by the API/CRUD review lens. Anomaly detection's absence means a leaked key is only mitigated by manual revoke until Phase 1.5.

## More information

- Spec source: `docs/spec.html` ADR-016 (rev 9). Enforced today in `packages/application/src/use-cases/upload-report.ts` (the `reports:write` gate → `InsufficientScope` → 403, ADR-0040). Keys store their scopes in `api_keys.scopes`; `authenticateApiKey` copies them onto the actor verbatim. Related: ADR-0008 (the keys), ADR-0039 (`reports:write`).
