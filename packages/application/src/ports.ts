// Driven ports for the Phase 1 use cases (hexagonal, ADR-0020). Use cases
// depend on these interfaces; Drizzle/R2 adapters implement them (1c.3) and
// in-memory fakes (./testing) back the use-case unit tests (ADR-0019 keeps the
// real e2e on real infra; these fakes are for fast use-case TDD only).
//
// Fallible I/O returns Promise<Result<T, AppError>> so failures thread through
// the functional pipeline (ADR-0024) instead of throwing. Pure services
// (ids/slug/clock) return plain values for deterministic tests.

import type {
  AppError,
  DomainEvent,
  OrgId,
  Report,
  ReportId,
  Result,
  Slug,
  TerminalScanStatus,
  UserId,
  VersionId,
} from "arp-domain";

// ── Reports & Folders persistence ─────────────────────────────────────────
export interface ReportRepository {
  findBySlug(slug: Slug): Promise<Result<Report | null, AppError>>;
  findById(id: ReportId): Promise<Result<Report | null, AppError>>;
  /** Persist the aggregate + any new versions (called inside a UnitOfWork). */
  save(report: Report): Promise<Result<void, AppError>>;
}

// ── R2 blob storage (keys: reports/<reportId>/<versionId>/<path>, ADR-0037) ──
export interface BlobFile {
  readonly path: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

export interface BlobStore {
  /** Write all blobs for a version (R2-first; commit-last in the use case). */
  putVersionBundle(
    reportId: ReportId,
    versionId: VersionId,
    files: readonly BlobFile[],
  ): Promise<Result<void, AppError>>;
  readObject(
    reportId: ReportId,
    versionId: VersionId,
    path: string,
  ): Promise<Result<BlobFile | null, AppError>>;
  /** GC: drop an orphaned version prefix after a pre-commit failure. */
  deleteVersionPrefix(reportId: ReportId, versionId: VersionId): Promise<Result<void, AppError>>;
}

// ── Bundle processing — sync pre-checks (ADR-0037 §1/§9, ADR-0015) ─────────
export interface ProcessedBundle {
  readonly files: readonly BlobFile[]; // normalized; entry resolved to index.html
  readonly entryDocument: string; // typically 'index.html'
  readonly contentHash: string; // bundle digest — idempotency-key input (ADR-0039)
  readonly sizeBytes: number; // uncompressed total
}

export interface BundleProcessor {
  /**
   * Validate + normalize an upload: MIME allowlist via content-sniff (SVG → 415,
   * ADR-0015), zip extraction + caps (per-file/count/decompression → 413),
   * entry-document resolution (index.html convention; ambiguous → 422), and the
   * content hash. Returns the processed bundle or the appropriate AppError.
   * The real (zip/sniff) implementation is an adapter; the use case stays pure.
   */
  process(filename: string, bytes: Uint8Array): Promise<Result<ProcessedBundle, AppError>>;
}

// ── Idempotency (ADR-0039) ────────────────────────────────────────────────
export interface IdempotencyKeyRef {
  readonly actingUserId: UserId;
  readonly route: string;
  readonly key: string;
}

export interface IdempotencyRecord {
  readonly responseStatus: number;
  readonly responseBody: unknown;
}

/** Outcome of claiming a key, before executing the mutation. */
export type IdempotencyBegin =
  | { readonly outcome: "proceed" } // new key claimed (state in_flight)
  | { readonly outcome: "replay"; readonly record: IdempotencyRecord } // completed match → replay
  | { readonly outcome: "in_flight" }; // concurrent retry still processing → 409

export interface IdempotencyStore {
  /**
   * Claim the key for this fingerprint. A reused key with a *different*
   * fingerprint resolves to err(IdempotencyKeyReuseDifferentBody) (422).
   */
  begin(ref: IdempotencyKeyRef, fingerprint: string): Promise<Result<IdempotencyBegin, AppError>>;
  /** Store the final response so future matches replay it. */
  complete(ref: IdempotencyKeyRef, record: IdempotencyRecord): Promise<Result<void, AppError>>;
}

// ── Transactional outbox (ADR-0021) ───────────────────────────────────────
export interface EventOutbox {
  /** Append events in the same transaction as the state change. */
  enqueue(events: readonly DomainEvent[]): Promise<Result<void, AppError>>;
}

// ── Scan port (Abuse & Moderation). Phase 1 stub always yields clean. ──────
export interface ScanQueue {
  /** Record a queued scan for a freshly-uploaded version (status `queued`). */
  enqueueScan(reportId: ReportId, versionId: VersionId): Promise<Result<void, AppError>>;
  /**
   * The versions still awaiting a scan (`scan_jobs.status = 'queued'`), capped at
   * `limit`. The drain reconciles these into the work queue each tick — so a
   * lost enqueue never strands a version at `pending` (scan_jobs is the work
   * list of record; the work queue is just the retrying processor).
   */
  listQueued(limit: number): Promise<Result<readonly ScanRequest[], AppError>>;
  /**
   * Best-effort `queued → running` transition (guarded queued-only) when the
   * worker picks the job up — the observability state the Phase-1 stub skipped.
   */
  markRunning(versionId: VersionId): Promise<Result<void, AppError>>;
  /**
   * Drive the version's scan job `running → done` with the terminal verdict
   * (called inside the same UnitOfWork as the promotion in processScanResult).
   * Phase 1: invoked synchronously with `clean`; Phase 1.5: by the scanner worker.
   */
  completeScan(versionId: VersionId, verdict: TerminalScanStatus): Promise<Result<void, AppError>>;
}

// ── Scan work queue (delivery). Distinct from the domain ScanQueue (scan_jobs
// is the source of truth for the viewer's cached scan_status); this is the
// transport that hands queued versions to the async worker — pg-boss on Neon in
// production, an in-memory fake in tests. Infra stays in the adapter (ADR-0024).
export interface ScanJobMessage {
  readonly reportId: ReportId;
  readonly versionId: VersionId;
  /** The delivery-layer job handle (pg-boss job id) — opaque to the application. */
  readonly jobId: string;
}

export interface ScanWorkQueue {
  /** Hand a freshly-uploaded version to the worker (best-effort, post-commit). */
  publish(reportId: ReportId, versionId: VersionId): Promise<Result<void, AppError>>;
  /** Claim up to `batchSize` queued jobs for processing (marks them in-flight). */
  fetch(batchSize: number): Promise<Result<readonly ScanJobMessage[], AppError>>;
  /** Remove a job from the queue after it was processed successfully. */
  complete(jobId: string): Promise<Result<void, AppError>>;
  /** Return a job to the queue (retried on a later tick) after a failure. */
  fail(jobId: string, reason: string): Promise<Result<void, AppError>>;
}

// ── Scanner (Abuse & Moderation). The verdict engine, behind a port so the ──
// Phase-1.5a always-clean stub and the real ClamAV/heuristics scanner are
// interchangeable with zero call-site change. Infra (pg-boss, ClamAV, …) lives
// in the adapter, never here (ADR-0024).
export interface ScanRequest {
  readonly reportId: ReportId;
  readonly versionId: VersionId;
}

export interface Scanner {
  /** Inspect a version's bundle and return a terminal verdict. */
  scan(req: ScanRequest): Promise<Result<TerminalScanStatus, AppError>>;
}

// ── Plan limits (ADR-0006) ─────────────────────────────────────────────────
export interface PlanLimiter {
  /** err(PlanLimitExceeded) (402) when the org is over a hard quota. */
  assertWithinPlan(orgId: OrgId): Promise<Result<void, AppError>>;
}

// ── Pure services (deterministic in tests) ─────────────────────────────────
export interface IdGenerator {
  reportId(): ReportId;
  versionId(): VersionId;
}

export interface SlugFactory {
  newSlug(): Slug;
}

export interface Clock {
  /** UTC epoch milliseconds (domain Timestamp). */
  now(): number;
}

export interface Hasher {
  /** Stable digest of the input (e.g. sha-256 hex) — the derived idempotency key (ADR-0039). */
  hash(input: string): string;
}

// ── Unit of work — atomic commit of repo + outbox + idempotency (ADR-0037 §5) ─
export interface UnitOfWork {
  /**
   * Run `work` atomically. For the upload pipeline the callback MUST include
   * `ReportRepository.save` + `EventOutbox.enqueue` + `IdempotencyStore.complete`
   * so they commit together (ADR-0037 §5, ADR-0039); the real adapter binds them
   * to a single transaction (the in-memory fake just runs the callback).
   */
  run<T>(work: () => Promise<Result<T, AppError>>): Promise<Result<T, AppError>>;
}
