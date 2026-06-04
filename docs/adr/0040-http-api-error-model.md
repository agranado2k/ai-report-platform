# ADR-0040: HTTP API error model (RFC 9457)

- **Status**: Accepted
- **Date**: 2026-06-04
- **Deciders**: agranado2k
- **Supersedes / amends**: complements ADR-0024 (Result type), ADR-0037/0038/0039; governs all HTTP/MCP responses.
- **Superseded by**: —

## Context and problem statement

The domain returns `Result<T, AppError>` (ADR-024); the HTTP adapter must translate `AppError` kinds into status codes and a response body "in one place." We need a single, interoperable error contract that agent/MCP clients can branch on programmatically, and a fixed kind→status mapping (with the genuinely debatable cells — plan-limit and idempotency — pinned).

## Decision drivers

- Machine-readable, standard error bodies for LLM/agent clients.
- Exactly one mapping site (the HTTP adapter); the domain stays pure and transport-agnostic.
- Distinguish "slow down" (transient) from "upgrade your plan" (hard quota) without overloading one code.

## Decision outcome

**Error body = RFC 9457 Problem Details (`application/problem+json`)** with the standard members (`type`, `title`, `status`, `detail`, `instance`) plus a stable, documented machine-readable **`code`**. The mapping lives **only** in the HTTP adapter; the domain returns `Result<T, AppError>`.

### `AppError` kind → HTTP status

| Kind | Status |
|---|---|
| `Unauthenticated` (missing/bad API key) | `401` |
| `NotAllowed` / `InsufficientScope` | `403` |
| `NotFound` (slug / folder / version) | `404` |
| `UnsupportedMediaType` (MIME not allowlisted, SVG) | `415` |
| `PayloadTooLarge` / `TooManyFiles` / `DecompressionBomb` | `413` |
| `ValidationError` (bad body, missing/ambiguous entry) | `422` |
| `IdempotencyKeyReuseDifferentBody` | `422` |
| `IdempotencyInFlight` | `409` |
| `PlanLimitExceeded` | `402` (billing-actionable) |
| `RateLimited` | `429` |
| (unexpected) | `500` |

Rationale for the debatable cells: **`402`** for plan-limit signals "billing action needed" and keeps it distinct from **`429`** rate-limiting (a hard quota won't clear by waiting / `Retry-After`); **`409`** for in-flight idempotent retries vs **`422`** for a reused key with a different body (a client bug).

### Scan outcomes are not upload-time errors

`flagged`/`blocked` are **asynchronous** — the upload returns `201` with `scan_status='pending'`; the verdict is surfaced later at **serve** time per ADR-0038 (`451`/`404`), never as a synchronous upload error. The only synchronous content errors are the sync pre-checks (415/413/422).

### Consequences

**Positive**
- Standard, typed, machine-branchable errors; one mapping site; pure domain.
- Clients distinguish transient vs hard-quota vs client-bug from `status` + `code`.

**Negative**
- `application/problem+json` content negotiation + a maintained `code` registry.
- `402` for quota is less common than `403`/`429` — must be documented so clients expect it.

**Neutral**
- The `code` registry travels with `docs/api/openapi.yaml`.

## Considered options

1. **RFC 9457 + `402` plan / `409` in-flight** *(chosen)*.
2. **Custom `{error:{code,message}}` envelope + `403` plan** — simpler, non-standard, conflates permission-denied with over-quota.
3. **RFC 9457 + `429` plan-limit** — overloads `429` with both rate-limit and hard-quota; `Retry-After` meaningless for a quota.

## More information

- [RFC 9457 — Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457).
- Related: ADR-0024 (`Result<T, AppError>`), ADR-0039 (`409`/`422`), ADR-0037/0038 (the kinds raised by upload/serve), ADR-027 (OpenAPI source of truth — the `code` registry lives there).
