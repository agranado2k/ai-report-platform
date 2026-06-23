# ADR-0053: Full Stripe-style API conventions — object + list envelopes, cursor pagination, mode + Request-Id

- **Status**: Accepted
- **Date**: 2026-06-23
- **Deciders**: agranado2k
- **Supersedes / amends**: —
- **Relates to**: ADR-0040 (RFC 9457 errors), ADR-0052 (prefixed External Ids), ADR-0036 (DDD), ADR-0051 (MCP wraps `/api/v1`), ADR-003/027 (OpenAPI source of truth).

## Context and problem statement

The `/api/v1` wire had two slices decided by ADR — **errors** (ADR-0040, RFC 9457 `problem+json`) and **ids** (ADR-0052, `report_`/`folder_` prefixes) — but the **success-response and list shape was convention-by-repetition**, with no ADR, and inconsistent: reports were offset-paged (`{reports:[…], page, page_size, total}`), folders returned the full tree (`{folders:[…]}`), no resource carried a type discriminator, and the OpenAPI `UploadResult` advertised a `dashboard_url` the code never emitted. The operator wants the API to read like a polished, third-party-grade product, with **Stripe** as the reference model.

## Decision drivers

- One uniform, self-describing envelope across every resource + list (reports, folders, and whatever sharing/ACL adds next).
- Stripe ergonomics end-to-end (we already adopted Stripe-style ids + snake_case + idempotency keys).
- A stable, unique pagination cursor that scales.

## Considered options

- **Full Stripe** *(chosen)* — `object` discriminator + `mode` on resources, `{object:"list", data, has_more}` lists, cursor pagination, `Request-Id` header.
- **Pragmatic-flat** — keep flat resources + named-collection lists + offset pagination, just document it. Rejected: the operator wants the full Stripe shape, and offset doesn't scale / isn't a clean cursor.
- **JSON:API** (`{data:{type,id,attributes,relationships}}`) — rejected: heavy, replaces the RFC-9457 errors, opposite of today's shape.

## Decision outcome

1. **Resource envelope.** Every resource is a flat, `snake_case` object carrying `"object": "<type>"` (`report` | `folder`) + `"mode"` + its prefixed External Id (ADR-0052). No JSON:API nesting.
2. **List envelope.** `{ "object": "list", "data": [<resource>…], "has_more": <bool> }`. No `total` (cursor lists don't count).
3. **Cursor pagination.** `limit` (1..100, default 20, clamped) + `starting_after` / `ending_before` (a prefixed id, mutually exclusive); `has_more` derived from a `limit+1` fetch. **Keyset on the UUIDv7 id, DESC = newest-created first.** This *changes the report ordering* from most-recently-**updated** to most-recently-**created** (a re-upload no longer jumps to the top) — the accepted trade-off for a stable, unique cursor key (`updated_at` is mutable + non-unique).
4. **mode.** `"prod"` on the live deployment, `"dev"` on preview/dev — derived from `API_KEY_ENV === "live"`. _(Amended 2026-06-23, same day: shipped first as a `livemode` boolean; changed to a `mode` enum before any external consumer, so it reads self-evidently and leaves room for more deployment kinds.)_
5. **Request-Id.** A `req_<base62>` correlation id on every response (the `Request-Id` header), generated at the http boundary.
6. **Unchanged.** Errors stay RFC 9457 (ADR-0040); casing is snake_case wire / camelCase domain, translated **only** in `packages/http`.

## Consequences

- **Good**: uniform, self-describing, third-party-grade payloads; one list shape across reports + folders + the MCP tools; cursor pagination scales without `OFFSET` cost; the convention is set before sharing/ACL adds resources.
- **Trade-offs**:
  - **Breaking wire change** — list shapes, pagination params, and resource fields all change. Landed **atomically** (we own the clients — the MCP + the dashboard), like ADR-0052. No deprecation window.
  - **Creation-desc ordering** — keyset on id means a re-upload no longer reorders the list; cursor lists drop `total` (no count).
  - **One index-only migration (no data change)** — the keyset query needs a `(org_id, id DESC) WHERE deleted_at IS NULL` partial index on `reports` + `folders` to stay O(page); migration `0005`. `ending_before` fetches ASC then reverses.
  - The server-rendered **dashboard** moved from page-number pagination to Prev/Next report-id cursors.

## More information

- Implemented across `packages/{domain,application,adapters,http}` (cursor model, keyset queries, `resource.ts` envelope builders), `apps/app` (`http.server` `parseCursorParams`/`wireContext`/Request-Id; cursor routes; dashboard), `apps/mcp` (cursor tool inputs + list envelope), and `docs/api/openapi.yaml` (List envelope, `object`/`mode`, cursor params, `dashboard_url` removed).
- The cursor **is** an ADR-0052 prefixed id — decoded via `make*Id` at the boundary (a malformed cursor → 422).
