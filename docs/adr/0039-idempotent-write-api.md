# ADR-0039: Idempotent write API

- **Status**: Accepted
- **Date**: 2026-06-04
- **Deciders**: agranado2k
- **Supersedes / amends**: complements ADR-0037 (upload pipeline), ADR-0040 (error model); applies to all mutating HTTP/MCP endpoints.
- **Superseded by**: —

## Context and problem statement

The write API is driven heavily by LLMs/agents and the MCP server, where network retries are routine. Without idempotency, a retried `POST /api/v1/reports` creates a duplicate report; a retried `set_acl` or grant may double-apply. The operator's directive: **every mutating endpoint is idempotent as a system-wide property**, not a per-endpoint trick. (`content_hash`-style per-endpoint dedup is uneven — it can't make a true *create* idempotent.)

## Decision drivers

- Safe client retries across all writes (create, re-upload, `set_acl`, grant, revoke, takedown…).
- Crash-consistency: "did it happen?" and "is it recorded as having happened?" must not disagree after a process death.
- Works even when a naive client sends **no** idempotency header.
- Standard, interoperable shape that agent/MCP clients already understand.

## Decision outcome

**An `Idempotency-Key` mechanism (IETF/Stripe-style), with a server-derived fallback key, persisted in Postgres in the same transaction as the mutation.**

### Key resolution

- If the client sends an **`Idempotency-Key`** request header, use it.
- If absent, the server **derives** one as a deterministic fingerprint of the canonical request:
  `key = hash(acting_user_id ∥ method ∥ route ∥ canonical-significant-payload)`.
  For the upload endpoint the payload term is dominated by the bundle **`content_hash`** plus the target (`update_slug` for re-upload, or `folder_path`/root for create). So identical content + target + user maps to the same derived key.

### Storage & transaction

- Table `idempotency_keys`, primary key `(acting_user_id, route, key)`, columns: `request_fingerprint`, `response_status`, `response_body`, `state`, `created_at`. 24h TTL, swept.
- The idempotency record is written **in the same Postgres transaction** as the mutation + outbox row. Postgres (not Redis) is required so the record can't desync from the data after a crash.

### Replay semantics

- Match (same key) → **replay** the stored `(status, body)` without re-executing.
- Explicit key reused with a **different** request fingerprint → `422` (client bug).
- Concurrent **in-flight** retry (record exists, still processing) → `409`.
- Recommended on all mutating endpoints; GETs are inherently safe. When no explicit key is given, the derived key still applies.

### Effect

- Create/re-upload retries auto-dedup with zero client effort: an identical upload within 24h replays the original response (same `slug`/version, no duplicate report/version).
- To **deliberately** republish byte-identical content as a *new* version, the client sends a **fresh explicit** `Idempotency-Key`.
- This subsumes the old `content_hash` no-op behavior (ADR-0037 §7): `content_hash` now feeds the derived key rather than driving its own dedup branch.

### Consequences

**Positive**
- Uniform idempotency across every write; create is idempotent too (the case per-endpoint semantics couldn't cover).
- Crash-consistent (record + data commit atomically).
- Safe even for clients that send no header.

**Negative**
- An `idempotency_keys` table + 24h sweep to operate; every write path threads the key.
- Derived-key behavior is subtle (deliberate identical-content republish needs an explicit fresh key) — must be documented.

**Neutral**
- 24h TTL is a retry-safety window, not a long-term dedup guarantee; identical content re-uploaded after the window creates a new version.

## Considered options

1. **`Idempotency-Key` header + derived fallback + Postgres tx-bound** *(chosen)*.
2. **Natural per-endpoint idempotency, no header** — create remains non-idempotent (the exact gap the operator wanted closed).
3. **Header + Upstash Redis store** — faster, no table, but not in the data transaction → a crash between data-commit and Redis-write desyncs and a retry re-executes.

## More information

- [IETF draft: The Idempotency-Key HTTP Header Field](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/); Stripe's idempotency model.
- Related: ADR-0037 (`content_hash` as derived-key input), ADR-0040 (`409`/`422` mapping), the spec's transactional-outbox decision.
