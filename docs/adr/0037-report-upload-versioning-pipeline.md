# ADR-0037: Report upload & versioning pipeline

- **Status**: Accepted
- **Date**: 2026-06-04
- **Deciders**: agranado2k
- **Supersedes / amends**: refines the upload flow in `docs/spec.html` (rev 8) and ADR-007 (zip bundle format); complements ADR-0039 (idempotent write API), ADR-0040 (error model), ADR-0036 (DDD).
- **Superseded by**: —

## Context and problem statement

Phase 1 builds the first real domain code: `UploadReportUseCase` and the `Report` aggregate. The spec (rev 8) fixes the *security* sequence (auth → permission → sync pre-checks → R2 → DB → outbox) and the storage layout, but leaves a cluster of **correctness** decisions unspecified: what a bundle's entry document is, what a re-upload may change, how a new report is placed, how blob writes and DB writes stay consistent across two non-transactional systems, how `version_no` is assigned under concurrency, when a version becomes live, and what the upload guardrails are. Deciding these once — before code cements them — avoids per-PR drift and rework.

This ADR covers the **write/ingest** side. Serving is ADR-0038; idempotency is ADR-0039; the error model is ADR-0040.

## Decision drivers

- The core value prop (ADR-001): re-upload updates the live version **without breaking the link**.
- Hosting untrusted HTML/JS safely (ADR-011/013): fail fast, fail closed, bound resource use.
- Functional/immutable domain with no I/O (ADR-024); aggregates testable without infrastructure (ADR-0036).
- Two stores (Postgres + R2) with no shared transaction — failures must be *harmless*, never *visible-but-broken*.
- Ergonomics for LLM/agent clients without sacrificing safety.

## Decision outcome

### 1. Entry document (what `GET /<slug>` serves)

`index.html` by convention. A single `.html` upload is normalized to `index.html`. If the archive root is a single wrapping directory (`myreport/…`), it is stripped so `myreport/index.html` → `index.html`. If no `index.html` resolves, or the archive is **ambiguous** (≥2 top-level directories, or multiple candidate `index.html`), the upload is **rejected at sync pre-check** (HTTP 422) — we never guess. This is a forgiving extension of ADR-007's "`index.html` at root."

New term: **Entry document** (see `docs/domain-glossary.md`).

### 2. Re-upload contract: content-only

`POST /api/v1/reports` is **content-only**. With `update_slug` present it creates a new `ReportVersion` and changes nothing else. `title`, `folder_path`, and `acl`/`csp_extras` on a re-upload are **rejected (422)** and routed to dedicated operations (`set_acl`, set-title, move). Rationale: a content push must never silently move a report or flip its sharing mode. `UploadReportUseCase` stays single-intent.

### 3. Create-time placement

`folder_path` is accepted **only at create** (no `update_slug`); omitted → the org's **root folder**. On re-upload, `folder_path` present → 422. Moving an existing report is a separate (deferred / dashboard) operation requiring `canWrite` on both source and destination. "Placement" is part of creation, not a mutation, so it doesn't violate the content-only rule and avoids a window where the report sits under the wrong inherited grants.

New term: **Root folder** (one per `Org`).

### 4. Identifier allocation

`reportId` (UUIDv7) and `slug` (`nanoid(10)`) are generated **app-side at create**, before the R2 upload (the R2 key needs `reportId`). Slug collision → regenerate. On re-upload both already exist.

### 5. Write ordering & R2 key scheme

R2 key = `reports/<reportId>/<versionId>/<path>`, where `versionId` is the `ReportVersion`'s UUIDv7 — **not** the spec's `v<n>` ordinal. This decouples storage from version numbering (no up-front ordinal coordination).

Ordering: **upload all blobs to R2, then commit the DB row + outbox in one transaction.** A `ReportVersion` row is invisible until commit, so a pre-commit failure leaves only **unreferenced blobs** under that `versionId`, reclaimed by a periodic **GC sweep** (delete `versionId` prefixes with no matching row, older than a threshold). This guarantees we never serve a row pointing at incomplete blobs.

### 6. `version_no` assignment & concurrency

`version_no` (1, 2, 3…) is a **display-only ordinal** assigned at commit as `max(version_no)+1` for the report, guarded by the `(report_id, version_no)` unique index. Two concurrent uploads to the same report both compute the same `n`; the index rejects the loser, which retries `max+1`. No additional locking.

### 7. `content_hash`

A bundle-level digest stored on `report_versions` for **integrity** and as the dominant input to the upload's **derived idempotency key** (ADR-0039). It does **not** itself trigger no-op/dedup control flow — retries are handled by the idempotency layer. No cross-version R2 storage dedup (keys are `versionId`-scoped; R2 is cheap).

### 8. Promotion: monotonic auto-promote

A new version uploads as `scan_status='pending'` with `live_version_id` unchanged. On `ReportVersionScanned(clean)` for version V, `PromoteVersionUseCase` sets `live_version_id = V` **only if** `V.version_no >` the current live (or live is null), then emits `ReportPublished` (welcome notification only on first publish). `flagged`/`blocked` never promote — a bad re-upload leaves the existing good version serving. Out-of-order clean results for older versions are ignored. Auto-promotion (not manual) is required by ADR-001.

### 9. Upload guardrails & MIME policy

**MIME allowlist**, validated by content-sniff / magic number (never the `Content-Type` header). `image/svg+xml` rejected (ADR-015). Anything not on the allowlist → 415.

Two tiers of limit:
- **Global security hard caps** (no plan can exceed; enforced as sync pre-checks): per-file ≤ 25 MiB, file count ≤ 20,000, uncompressed bundle ≤ 250 MB, decompression ratio block at 1000:1 (screen at 100:1), **nested archives rejected**, extraction time/memory-bounded and sandboxed.
- **Plan quotas** (`PlanLimiter.assertWithinPlan`, ADR-006, free-plan defaults active in Phase 1): reports per `Org`, total storage per `Org`, compressed-size cap per plan.

These numbers are tunable config; their *basis* is benchmarked against Cloudflare Pages (25 MiB/file, 20k files), GitHub Pages (1 GB site), and zip-bomb research (DEFLATE ~1032:1 ceiling; multi-threshold + depth + sandbox).

### Consequences

**Positive**
- Single-intent `UploadReportUseCase`; no hidden permission/sharing side effects.
- Crash-consistent: no served version ever points at incomplete blobs; failures degrade to GC-able orphans.
- No version-number coordination; concurrency handled by a unique-index retry.
- Re-upload can't take down a live report (bad scans don't promote).

**Negative**
- Chattier API: create-then-`set_acl`/set-title to finish setup (accepted; safer).
- A GC sweep must exist to reclaim orphan blobs (operational job).
- Diverges from the spec's documented fat upload body and `v<n>` key scheme (synced in rev 8).

**Neutral**
- `content_hash` keeps its column but changes role (integrity + idempotency input).

## Considered options (key forks)

- **Re-upload scope**: content-only *(chosen)* vs fat-upsert (move + ACL via upload — surprising side effects) vs content-only-even-title.
- **Write ordering**: UUID keys + R2-first/commit-last + GC *(chosen)* vs `v<n>` ordinal keys + reserve-then-upload vs DB-first with an `uploading` status.
- **Promotion**: monotonic auto-promote *(chosen)* vs last-scan-wins (demotes under races) vs manual promote (breaks ADR-001).
- **MIME**: allowlist *(chosen)* vs blocklist (new dangerous types slip through).

## More information

- `docs/spec.html` rev 8 — upload flow, schema cards (`report_versions`, `scan_jobs`).
- `docs/domain-glossary.md` — `Report`, `ReportVersion`, `Entry document`, `Root folder`, `Slug`, `Scan status`.
- `docs/events.md` — `ReportVersionUploaded`, `ReportVersionScanned`, `ReportPublished`.
- Related: ADR-001 (slug + versions), ADR-006 (plan limits), ADR-007 (zip bundle), ADR-012 (scanning), ADR-015 (SVG), ADR-0038/0039/0040.
- Research: [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/), [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits), [A better zip bomb (USENIX WOOT'19)](https://www.usenix.org/system/files/woot19-paper_fifield_0.pdf).
