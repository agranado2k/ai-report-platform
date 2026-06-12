# ADR-0045: Async content-scan pipeline (pg-boss on Neon, Cloudflare cron trigger)

- **Status**: Accepted
- **Date**: 2026-06-11
- **Deciders**: agranado2k
- **Supersedes / amends**: amends the Phase-1 "synchronous always-clean scan stub" (recorded in `docs/diary.md` 2026-06-10 + `docs/db-design.md`). Builds on ADR-0012 (content scanning), ADR-0037 §8 (monotonic promote-if-newer), ADR-0038 (viewer state machine).
- **Superseded by**: —

## Context and problem statement

The platform hosts **untrusted user HTML**. ADR-0012 specifies a three-stage scan (sync pre-checks → async ClamAV + phishing/miner heuristics → verdict gates publication). Phase 1 shipped a **placeholder**: the upload route calls `processScanResult("clean")` **synchronously** in-request, so a version promotes to live before the 201 returns. Three problems:

1. The 201's `scan_status: pending` is a **lie** — promotion already happened.
2. The viewer's `pending` / holding-page branch (ADR-0038) is **dead code** — never exercised.
3. The `@phase-1` acceptance tests asserting "not live until `ReportVersionScanned` clean" **can't be made truthful** against a synchronous promote.

We need the **real async pipeline** — queue → worker → verdict → monotonic promote — so the production scan engine slots in later behind one seam. The MVP runs **invite-only among friends** ("safe" environment), so the *verdict* can stay a dummy `clean` for now; what must be real is the **asynchrony**.

No async-execution primitive was provisioned (Upstash Redis is rate-limit/cache only; no queue, no cron, no worker host). And the chosen queue must not pull in heavy new infrastructure.

## Decision drivers

- **Minimize new infrastructure** — reuse what's already provisioned (Neon, Cloudflare) over standing up new services.
- **Keep the verdict engine swappable** — the dummy scanner and the eventual ClamAV/heuristics engine must be interchangeable with zero call-site change.
- **Correctness** — no uploaded version may be stranded at `pending`; promotion stays monotonic (ADR-0037 §8); duplicate delivery must be a no-op.
- **Keep uploads fast** — don't add queue infrastructure to the user-facing upload request path.
- **Everything-as-code** (ADR-017) where practical.

## Decision outcome

### 1. Queue = **pg-boss on the existing Neon Postgres**

No Redis. **BullMQ is incompatible with Upstash serverless Redis** (it needs blocking commands `BZPOPMIN` + persistent connections + `duplicate()`, and polls Redis continuously — see bullmq#1087 / Upstash's own docs), so it would force a **new dedicated Redis service plus a persistent worker process** — more infrastructure, not less. pg-boss reuses the Neon database we already run and fits the repo's transactional patterns. Pinned at **exactly `12.18.3`** (see §5).

### 2. pg-boss **self-manages its `pgboss` schema** (`migrate: true`)

The `app` role **owns** the `ai_report_platform` database, so pg-boss can `CREATE SCHEMA pgboss` and its tables itself, with no privilege grant, memoized once per warm lambda (pg-boss takes its own advisory lock so concurrent cold-boots can't collide).

This is a **deliberate exception** to the everything-as-code migrate-db pipeline (ADR-017/018): `pgboss` is a **vendor-managed schema**, invisible to `drizzle-kit` and `migration-check`. We accept it because **pg-boss 12 creates per-queue partitioned tables via runtime `createQueue` DDL** that cannot be cleanly frozen into a static migration — a migration-file approach would be incomplete *and* carry an ongoing maintenance tax (every pg-boss bump = a regenerated, re-reviewed migration). Our own app tables in `public` still go exclusively through Drizzle migrations. The supervisor and cron scheduler are **off** (`supervise:false, schedule:false`) — this is a stateless drain, not a long-lived worker.

> Alternatives considered: (2a) pin **pg-boss 9** (single-table model) to keep a pure migration-file approach — rejected, runs a 3-year-old major for a new integration; (2b) capture the full v12 DDL into a migration — rejected, the partition DDL is fragile and incomplete. Both swappable behind the port (§4) if the everything-as-code constraint later outweighs the maintenance cost.

### 3. Trigger = **Cloudflare Cron Trigger Worker → `POST /internal/scan-drain`**

A tiny Worker on the **free** Workers plan fires every minute and `fetch()`es the app's drain route with a shared bearer secret (`SCAN_DRAIN_SECRET`, a self-generated `random_password`, fail-closed). Cloudflare is **already a vendor** (DNS/R2/zone), so no new provider beyond `hashicorp/random`; no Vercel Pro, no always-on host. The Worker holds **no logic** — only the trigger — so the scan engine stays in the app's domain code and the trigger is swappable. `infra/terraform/modules/scan-cron`.

> Alternatives: Vercel Cron (needs Pro for sub-daily), an always-on pg-boss worker on Fly/Railway (a persistent host), QStash (another managed service), or a CF Worker doing the whole drain via its R2 binding + Neon serverless driver (runs domain code in a second runtime). The cron-pokes-the-app shape was chosen as the minimal-infra option that keeps pg-boss + domain code in one runtime.

### 4. The pipeline shape

- **`Scanner` port** (`packages/application`) with **`CleanStubScanner`** (returns `clean`). The single seam for the real engine.
- **`ScanWorkQueue` port** (publish/fetch/complete/fail) with **`PgBossScanWorkQueue`**. **pg-boss is confined to two adapter files** behind this port — replacing it (e.g. with a Postgres SKIP-LOCKED queue or a managed queue) is a localized adapter change; nothing in domain/application moves.
- **`scan_jobs` is the work list of record.** The upload path is **unchanged** (it writes a `queued` row, no pg-boss). The drain **reconciles** `queued` rows into pg-boss each tick (`ScanQueue.listQueued`), so a version uploaded mid-tick — or whose enqueue was otherwise lost — is always picked up. Nothing strands at `pending`. This replaces the originally-planned separate publish-on-upload + reconciler with one mechanism, and keeps uploads fast.
- **`drainScans`** (application use case): reconcile → fetch a batch → per job `markRunning` → `Scanner.scan` → `processScanResult(verdict)` (monotonic promote) → `complete`/`fail`. Unit-tested with in-memory fakes (happy path, empty, scanner-fail retry, duplicate-delivery idempotency, reconcile).
- **No cron-overlap advisory lock.** pg-boss `fetch` claims jobs with `FOR UPDATE SKIP LOCKED`, so concurrent ticks **split** work rather than double-process; reconcile and processing are idempotent (`completeScan` `ne(status,'done')` guard + the `scan_jobs` unique index + monotonic promote). The advisory lock the plan originally mandated is therefore **redundant** and was dropped.

### 5. pg-boss is pinned exactly

A pg-boss minor bump can add a schema migration. Since pg-boss owns its schema at runtime this is normally safe, but to keep the library and the live schema in lockstep we pin **exactly** (`"pg-boss": "12.18.3"`) and treat upgrades as a reviewed change.

### Consequences

- ✅ Real async pipeline on **zero new datastores** and **zero new managed services** beyond a free CF Worker; uploads stay fast.
- ✅ Verdict engine and queue both swappable behind ports — the ClamAV/heuristics engine (ADR-0012) drops in behind `Scanner` later with no call-site change.
- ✅ No version stranded at `pending`; idempotent under retries and overlapping ticks.
- ⚠️ The `pgboss` schema is vendor-managed, outside the migrate-db pipeline (documented exception).
- ⚠️ pg-boss uses node-postgres TCP (not the WebSocket serverless driver); point it at Neon's **pooled** endpoint (`SCAN_QUEUE_DATABASE_URL`, defaults to `DATABASE_URL`) with a tiny pool at scale.
- ⚠️ Operator prerequisite: the Cloudflare API token needs **Workers Scripts: Edit** to apply `modules/scan-cron` (see `docs/infra.md`).

## Considered options

- **Queue** — *pg-boss on Neon* (chosen) · *BullMQ + a new dedicated Redis* (rejected: incompatible with the existing Upstash serverless Redis, needs a persistent worker — most infra) · *Upstash QStash / Inngest* (rejected for now: another managed service when Postgres suffices).
- **pg-boss schema** — *self-managed `migrate:true`* (chosen) · *pin pg-boss 9 + hand-written migration* (rejected: 3-year-old major) · *capture full v12 DDL into a migration* (rejected: partition DDL fragile + incomplete). See §2.
- **Trigger** — *Cloudflare cron Worker → app drain route* (chosen: free, existing vendor, one runtime) · *Vercel Cron* (needs Pro for sub-daily) · *always-on pg-boss worker on Fly/Railway* (a persistent host) · *QStash schedule* (another managed service) · *CF Worker runs the whole drain* (domain code in a second runtime). See §3.
- **Enqueue** — *drain reconciles `scan_jobs` queued rows each tick* (chosen: uploads stay fast, nothing strands) · *publish-on-upload + a separate reconciler* (rejected: pg-boss on the upload critical path + a dual-write). See §4.

## The content-scanning model (best practices)

ADR-0012 names ClamAV, but for **hosting untrusted static HTML, signature AV is the least important layer** — runtime **isolation** dominates. The defense-in-depth model this pipeline serves:

1. **Sync pre-checks** — MIME allowlist (content-sniffed), per-file/size/file-count/decompression-ratio caps, nested-archive rejection (ADR-0037 §9). *Partly built.*
2. **Origin isolation + sandbox CSP** — the **primary** runtime containment for malicious JS/XSS: the viewer is served from a PSL-isolated origin under a strict sandbox CSP (ADR-002/0013/0038), so even fully-malicious report HTML can't touch the app origin's cookies/storage. **For static HTML, isolation > AV.** *Built.*
3. **Async signature scan (ClamAV)** — catches **known malware** in downloadable bundle assets. *This pipeline; engine deferred.*
4. **Heuristics** — phishing/credential-harvest pages + cryptominers (JS/WASM). *Deferred.*
5. **Reactive** — abuse reporting + fast takedown (ADR-0012), since no scanner catches everything.

Phase 1.5a delivers layer 3's **transport** with a stub verdict; layers 3–4's **engine** are a later phase, slotting behind the `Scanner` port.

## Delivery

Two PRs. **PR1** (additive, the synchronous promote stays as a liveness safety net): the ports, adapters, drain route, env, the CF `scan-cron` module, and this ADR. **PR2** (`refactor/scan-async-only`): remove the synchronous `processScanResult` from the upload routes (the 201 then truthfully returns `pending`), update the e2e to poll-until-promoted + assert the holding page, and add the viewer `pending`-branch regression test. The real scan **engine** is a later phase.

## More information

- pg-boss connection note: separate `SCAN_QUEUE_DATABASE_URL` (pooled) keeps pg-boss off DbContext's WebSocket pool. Verify `fetch/complete` under PgBouncer transaction-pooling; if session-state features break, use a direct endpoint with a tiny pool.
- Cron only targets prod; previews are drained by the e2e itself (`POST /internal/scan-drain` with the secret), since `SCAN_DRAIN_SECRET` is set on `preview` too.
- workers.dev subdomain (CF error `10063`): a Worker cron trigger can't be created until the account has a workers.dev subdomain, and **no native TF resource exists** for it (v4 or v5 — only the per-script `workers_script_subdomain` toggle). The `scan-cron` module registers it via the API in a `null_resource` (`PUT /accounts/{id}/workers/subdomain`), gated before the cron trigger. See `docs/infra.md` §"Async scan pipeline".
