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

## Amendment (2026-08-07) — the derived fallback is unsound for state-setting writes

Reported as issue #233, detail preserved in **GHSA-ghxh-82j4-pp6m**. Two defects, one root cause: the derived-key fallback was applied to every mutating use case, and the 24h window this ADR describes was never enforced.

**Defect 1 — the fallback fails OPEN on writes that set state.** The derived key is `hash(user ∥ route ∥ hash(canonical significant payload))`. For a one-shot write (add a comment, create a folder) that is exactly right: the payload identifies the *request*, so a retry is a duplicate and replaying it is the guarantee. For a write that sets STATE, the payload identifies the *desired state* — so `org → private → org` derives the key of the FIRST call and replays it. The API answers `200` with the stale body and never re-applies. The delete-shaped variant is worse: the key can be burned **before** the fact, so the real call no-ops — which for `revoke-write` means the grantee keeps write access, and for `set-acl` means a revoked share silently survives.

**Decision:** the classification is now a REQUIRED field on `IdempotentWriteInput` — `derivedFallback: "sound" | "unsound"`. `unsound` skips the derived key entirely; an EXPLICIT `Idempotency-Key` still claims and replays exactly as before, because that is the guarantee a client actually asked for. Required rather than defaulted because the wrong answer fails open and silently: a new use case must decide, and the compiler makes it.

The flag names what it **controls**, not one rationale for it — `create-api-key` is `unsound` for an unrelated reason (a swallowed duplicate mint returns a key summary with no secret, which is worse than the cheap, revocable duplicate it would prevent). Five use cases had hand-rolled this carve-out locally after #230; those local guards are removed, so the decision now lives in exactly one place.

**Behaviour change, accepted deliberately:** a keyless retry of a delete-shaped write now returns the natural error (`404` — it is already gone) instead of a replayed `204`. Clients wanting exactly-once retry semantics send an `Idempotency-Key`. Masking that with a permanent derived record is precisely the hole.

**Defect 2 — the 24h window was fiction.** No sweep and no predicate enforced it; a record replayed forever, which is what turned defect 1 from a 24h annoyance into a permanent one. Expiry is now enforced at CLAIM time, and an expired record is **reclaimed in place** rather than hidden: filtering it out of the lookup would answer `in_flight`/`409` forever, a worse failure than the staleness it fixes. The reclaiming UPDATE is conditioned on the row still being stale, so a concurrent reclaim falls through to the conservative `in_flight`. Rows still accumulate — a purge job remains an operational follow-up, but its absence is now a storage cost rather than a correctness one.

### Consequences of the amendment, stated explicitly

Four follow-on effects, recorded because a review found each of them undocumented rather than because any is a surprise:

- **Duplicate audit rows.** A keyless retry of any `unsound` operation now re-executes, so one logical action can write N `acl.set` / `grant.write.granted` / `comment.resolved` rows after an ordinary network retry. `resolve-comment` is the sharpest case: the domain transition is a genuine no-op on an already-resolved comment, but the use case audits unconditionally, so the row records a resolution that did nothing. That is a reporting-fidelity cost of the fix, accepted.
- **An expired key reused with a different body now proceeds instead of `422`.** Past the 24h window the key is genuinely free, so `IdempotencyKeyReuseDifferentBody` no longer applies. This is a wire-contract change on a documented status code; `openapi.yaml` states it.
- **The reclaim is a destructive write outside the caller's transaction.** `beginIdempotentWrite` runs before `uow.run`, so the reclaiming `UPDATE` autocommits and nulls the expired response before the replacement mutation is known to succeed. If that request then fails, the row is left `in_flight` with a fresh `createdAt` and the key answers `409` for another window. This is the same shape as the pre-existing "claim then crash" case this ADR already documents, and the record it discards was already expired and unusable — but it is a real failure mode and it is not crash-consistent in the way the mutation/record pair is.
- **The primary client sends no key.** `apps/mcp/src/client.ts` sets only `accept`, `authorization` and `content-type` on every request — `uploadReport` documents that omission deliberately. So the mitigation "clients wanting exactly-once retry send an `Idempotency-Key`" does **not** currently apply to the agent-driven client ADR-0039 was written for. Concretely, via MCP: the 17 `unsound` operations have no retry protection, the six delete-shaped ones surface a `404` to the agent for a call that actually succeeded, and a retried `create-api-key` mints a second credential. Threading a key through the MCP client is the obvious follow-up and is **not** in this change.

## Considered options

1. **`Idempotency-Key` header + derived fallback + Postgres tx-bound** *(chosen)*.
2. **Natural per-endpoint idempotency, no header** — create remains non-idempotent (the exact gap the operator wanted closed).
3. **Header + Upstash Redis store** — faster, no table, but not in the data transaction → a crash between data-commit and Redis-write desyncs and a retry re-executes.

## More information

- [IETF draft: The Idempotency-Key HTTP Header Field](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/); Stripe's idempotency model.
- Related: ADR-0037 (`content_hash` as derived-key input), ADR-0040 (`409`/`422` mapping), the spec's transactional-outbox decision.
