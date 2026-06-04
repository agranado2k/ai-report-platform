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
  UserId,
  VersionId,
} from 'arp-domain';

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
  putVersionBundle(reportId: ReportId, versionId: VersionId, files: readonly BlobFile[]): Promise<Result<void, AppError>>;
  readObject(reportId: ReportId, versionId: VersionId, path: string): Promise<Result<BlobFile | null, AppError>>;
  /** GC: drop an orphaned version prefix after a pre-commit failure. */
  deleteVersionPrefix(reportId: ReportId, versionId: VersionId): Promise<Result<void, AppError>>;
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
  | { readonly outcome: 'proceed' } // new key claimed (state in_flight)
  | { readonly outcome: 'replay'; readonly record: IdempotencyRecord } // completed match → replay
  | { readonly outcome: 'in_flight' }; // concurrent retry still processing → 409

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
  enqueueScan(reportId: ReportId, versionId: VersionId): Promise<Result<void, AppError>>;
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
