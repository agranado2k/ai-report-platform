# ADR-0055: OpenTelemetry observability — three pillars to Grafana Cloud

- **Status**: Accepted
- **Date**: 2026-06-23
- **Deciders**: agranado2k
- **Amends**: ADR-0053 §5 (Request-Id — see Decision 9)
- **Relates to**: ADR-0024 (functional/pure domain + application), ADR-0045 (async scan pipeline), ADR-0051 (MCP over `/api/v1`), ADR-0052 (prefixed External Ids), ADR-0038 (slug = capability URL), ADR-0017/0018 (everything-as-code / Terraform).

## Context and problem statement

The platform had **almost no observability** — ~5 `console.*` calls total and no structured logging, traces, or metrics — across a distributed topology (Remix app + Express MCP + viewer on Vercel, a Cloudflare cron Worker, and an async pg-boss scan pipeline). Debugging a cross-service or async-pipeline issue meant guessing. We want standard, correlated telemetry — *"a `trace_id` for everything"* — without running infrastructure we have to babysit.

## Decision drivers

- One correlated view across services + the async pipeline (logs ↔ traces ↔ metrics by `trace_id`).
- Minimal ops (serverless + edge; no self-hosted collector/backend if avoidable).
- Vendor-neutral instrumentation (OpenTelemetry), and a backend an **agent can query via MCP**.
- Must not compromise ADR-0024 purity, capability-URL secrecy (ADR-0038), or leak secrets/PII.

## Decision outcome

1. **Three pillars.** Traces **+ metrics + logs**, all via OpenTelemetry (not logs-only).
2. **Backend: Grafana Cloud** (Tempo / Loki / Mimir). Chosen over Axiom and Honeycomb primarily for the **richest MCP server** (`grafana/mcp-grafana`: LogQL, Tempo, PromQL, Sift) queryable from this repo, plus a free tier and a Terraform provider. (Honeycomb's MCP is Enterprise-gated; Axiom's hosted MCP is Pro-gated.)
3. **Direct OTLP export, no collector.** Each runtime ships OTLP straight to Grafana Cloud's gateway (OTLP/HTTP + basic-auth). Serverless/edge has no natural home for a long-lived collector. Consequence: **redaction happens at the source** (Decision 12), not centrally.
4. **Vercel apps (Remix + Express MCP): `@vercel/otel`.** It solves the **span-flush-before-freeze** trap that the vanilla SDK drops on Vercel. Called manually from each server entry (works outside Next); `fetch` auto-instrumentation gives **MCP→/api/v1** trace continuity (with `propagateContextUrls` set to our domains); `pg` + `pino` instrumentations added.
5. **Coverage.** `app` + `mcp` now; **`view` deferred** (low debugging value, serves untrusted content); the **Cloudflare cron Worker** fully instrumented via **`otel-cf-workers`** (OTLP → Grafana, `traceparent` propagation).
6. **Async pipeline linking.** The upload trace and the (later) drain trace are separate. We add a nullable `scan_jobs.trace_context` column; the **scan-queue adapter** captures the W3C `traceparent` at `enqueueScan`, and the drain creates an OTel **span link** from each per-job span back to the upload span. **Always-on business-id attributes** (`report.id`/`version.id`) on both traces give a complementary search-correlation path.
7. **Logs.** `pino` + `@opentelemetry/instrumentation-pino` bridged to the OTel **Logs SDK → OTLP → Loki**; `trace_id`/`span_id` auto-injected. A shared **`packages/observability`** owns the setup; the `console.*` calls are replaced.
8. **Metrics.** **Emitted from the functions** (not span-derived): auto HTTP RED (rate/errors/duration by route) + custom counters (`scan.verdict`, `webhook.received`, `auth.result`, `upload.result`). **Delta temporality**, **per-invocation force-flush**, and **low-cardinality labels only** (never `report_id`/`user_id`/`trace_id`/`slug` on a metric — Mimir cost). Host/runtime metrics deferred.
9. **`Request-Id` *is* the trace (amends ADR-0053 §5).** `Request-Id = req_<base62(trace_id)>` — same `req_…` wire shape as ADR-0053, but the value is the reversibly-encoded `trace_id` (reuses the ADR-0052 base62 codec). Generation **inverts**: read the active span's `trace_id` at response time; **fall back** to a random `req_` id when no trace is active. So a support `Request-Id` decodes straight to a Tempo trace.
10. **Sampling: 100%** pre-launch (every `Request-Id` resolves to a findable trace). Revisit head/tail sampling when volume/cost grows; Grafana free-tier limits are the initial guardrail.
11. **Purity (ADR-0024).** Tracing/logging/metrics are I/O — they live **only** in adapters + apps (routes, the scan-queue adapter, `packages/observability`). `packages/domain` and `packages/application` stay side-effect-free; use cases never import a logger/tracer.
12. **Redaction at source** (no collector to scrub). Hard denylist: `arp_` keys, Clerk JWTs, the Clerk webhook secret, R2 creds, DB URLs, the Grafana token, **report content**, auth headers (`Authorization`/`Cookie`/`X-API-Key`), request/response bodies, and `email`. Prefer **`report_id` over `slug`** as the identifier (a slug is a capability URL, ADR-0038); tolerate slug only where intrinsic (the viewer path). Enforced via `pino` `redact` + http-instrumentation header/body suppression + an attribute-allowlist mindset.
13. **Config: optional / fail-open.** OTLP endpoint + Grafana token in `packages/env` (optional); unset → telemetry off, app boots (the `API_KEY_PEPPER` pattern). The Grafana token is wired like the Clerk webhook secret (TF var → Vercel env + CF secret + GH Actions secret). Resource attributes: `service.name` ∈ {`arp-app`, `arp-mcp`, `arp-worker`}, `deployment.environment` ∈ {`prod`,`preview`,`dev`}, `service.version` = the release tag.

## Considered options

- **Backend**: Grafana Cloud *(chosen)* vs Axiom (simplest, Vercel/CF-native, but Pro-gated hosted MCP) vs Honeycomb (great traces, Enterprise-gated MCP, weak metrics) vs Datadog/New Relic ($$$) vs self-hosted SigNoz (ops).
- **Vercel instrumentation**: `@vercel/otel` *(chosen — flush-safe)* vs vanilla `@opentelemetry/sdk-node` (broadest auto-instrumentation but drops spans on Vercel without hand-rolled flush).
- **Async linking**: span links *(chosen)* vs trace-id-as-attribute vs business-id correlation only.
- **Metrics**: emit from functions *(chosen)* vs Grafana span-derived (Tempo metrics-generator).
- **Request-Id**: unify as `req_<base62(trace_id)>` *(chosen)* vs keep separate + stamp as a `request.id` span attribute vs raw hex.

## Consequences

- **Good**: one correlated debugging surface; agent-queryable via `mcp-grafana`; the async pipeline is causally linked; `Request-Id` → trace in one hop; vendor-neutral instrumentation (re-pointable off Grafana).
- **Trade-offs / risks**:
  - **Grafana Cloud lock-in** at the backend layer (instrumentation stays portable).
  - **Metrics-on-serverless is the riskiest piece** (Decision 8): `@vercel/otel`'s metrics flush is weaker than its span flush — verify per-invocation `forceFlush` (likely `waitUntil`) early.
  - **One schema migration** — `scan_jobs.trace_context` (nullable; no data change).
  - `Request-Id` becomes a random 128-bit value (not time-ordered UUIDv7) and is only Tempo-findable while sampling is 100%.
  - Redaction is our responsibility at every emission point (no central scrub).

## More information

- To be implemented as `packages/observability` (shared `@vercel/otel` + `pino` + OTel Logs/Metrics setup) consumed by `apps/app`, `apps/mcp`, and the Cloudflare Worker (`otel-cf-workers`); the `scan_jobs.trace_context` migration; `Request-Id` derivation in `http.server`; env + Terraform secret wiring; and `docs/observability.md` + the diary.
