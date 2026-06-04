# ADR-0043: Validate environment variables with Zod + @t3-oss/env-core

- **Status**: Accepted
- **Date**: 2026-06-04
- **Deciders**: agranado2k
- **Supersedes / amends**: complements ADR-0024 (functional domain — keeps Zod *out* of domain/application), ADR-0040 (error model — Zod will also back HTTP request validation later).
- **Superseded by**: —

## Context and problem statement

Phase 1 wiring (the Drizzle/R2/Clerk adapters in VS-2/VS-3) reads a growing set of env vars — `DATABASE_URL`, R2 credentials, Clerk keys, Upstash, plus Vercel system vars. Today they're read as bare `process.env.X` with no validation, so a missing or malformed var fails late, deep in a request, with an opaque error. We want one typed, validated env contract that **fails fast at boot**. Crucially, two of our deployables are **Remix apps with client bundles**, so the real hazard is **leaking a server secret (`CLERK_SECRET_KEY`, `R2_SECRET_ACCESS_KEY`, `DATABASE_URL`) into the browser**. The repo currently has no validation library.

## Decision drivers

- Fail fast at the composition root on misconfiguration, with a readable aggregated error.
- A single typed source of truth — no bare `process.env` scattered across the code.
- Never ship a server secret to a client bundle (we have client-bundled apps; the bare `parse(process.env)` reference pattern from a backend-only service doesn't guard this).
- Correct under bundlers (Vite/Remix) + the Vercel edge runtime.
- Keep the dependency-locked layers (`domain`/`application`, ADR-0024) free of it.

## Decision outcome

**A shared `packages/env` (`arp-env`) that defines Zod schemas and wraps them with `@t3-oss/env-core`'s `createEnv()`.** Adopt **two** boundary dependencies: `zod` and `@t3-oss/env-core`.

- **Server/client split.** Server-only secrets live in the `server` schema; client-safe vars use a `PUBLIC_` `clientPrefix`. `@t3-oss/env-core` enforces — at type *and* runtime — that a server var can never be placed in the client schema or read on the client (`onInvalidAccess` throws), so no secret reaches the browser bundle.
- **`emptyStringAsUndefined`** so `FOO=""` counts as unset (defaults/required fire correctly).
- **Vercel preset** (`@t3-oss/env-core/presets-zod`) types `VERCEL_ENV`/`VERCEL_GIT_COMMIT_SHA`/etc.
- **`defineEnv(runtimeEnv = process.env)`** is the side-effect-free factory; the server/adapter composition root calls it once and imports the typed result. Tests inject a mock `runtimeEnv`. Reusable schema helpers (`trimmedString`, `coercedNumber`, `boolFromString`, `csvList`) live alongside.
- **Boundary-only.** `zod`/`@t3-oss/env-core` are used in `packages/env`, `apps/*`, and `packages/adapters/*` — **never** in `packages/domain` or `packages/application` (ADR-0024 keeps those vanilla TS). Zod will later also back HTTP request-body validation (ADR-0040's `application/problem+json` errors); adopting it once covers both.

### Consequences

**Positive**: fail-fast typed env; no secret can leak to the client bundle (enforced); bundler/edge-correct; one validator for env + future request validation.

**Negative**: two new boundary deps (`zod`, `@t3-oss/env-core`). Client vars must adopt the `PUBLIC_` prefix (a naming convention to apply when the apps wire public vars in VS-3).

**Neutral**: `@t3-oss/env-core` is validator-agnostic (standard-schema); we pin it to Zod.

## Considered options

1. **Zod + `@t3-oss/env-core`** *(chosen)* — server/client split + `runtimeEnv` + `emptyStringAsUndefined` + Vercel preset; the safety the bare pattern lacks for client-bundled apps.
2. **Zod + a hand-rolled `loadEnv`** (the reference pattern) — fewer deps, but we'd own the client-secret-leak prevention + bundler/runtimeEnv handling (easy to get subtly wrong with a browser bundle).
3. **A vanilla-TS validator, no Zod** — zero deps, consistent with the in-repo `Result`/`pipe`, but reinvents coercion/error-reporting and won't serve the upcoming request validation.

## More information

- [@t3-oss/env-core](https://env.t3.gg/docs/core) · [customization](https://env.t3.gg/docs/customization) (server/client split, `clientPrefix`, `emptyStringAsUndefined`, presets).
- Reference pattern that prompted this: `zora-pantheon/apps/agent-service/src/common/environment` (Zod schema + `parse(process.env)` — backend-only, no client bundle).
- Related: ADR-0024 (domain/application stay vanilla), ADR-0040 (request validation), ADR-0004/0005 (R2/Clerk), and `docs/infra.md` (the env-var inventory).
