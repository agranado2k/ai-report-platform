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
  Folder,
  FolderId,
  OrgId,
  Report,
  ReportId,
  Result,
  Slug,
  TerminalScanStatus,
  UserId,
  VersionId,
} from "arp-domain";

/**
 * A lightweight read projection of a Report for list views (the dashboard).
 * Deliberately NOT the full aggregate — listing must not load every version's
 * manifest. `isPublished` = a clean version is live (vs still pending). A richer
 * per-version status badge (e.g. flagged) is a follow-up. `folderId` lets the UI
 * group reports under their folder in the tree.
 */
export interface ReportSummary {
  readonly slug: Slug;
  readonly title: string;
  readonly isPublished: boolean;
  readonly folderId: FolderId;
}

/** A paged, optionally-filtered query over an org's reports (dashboard search). */
export interface ReportSearchQuery {
  /** Case-insensitive substring matched against title + slug. Omitted = no filter. */
  readonly query?: string;
  /** Restrict to one folder. Omitted = org-wide (across all folders). */
  readonly folderId?: FolderId;
  readonly limit: number;
  readonly offset: number;
}

/** One page of report summaries plus the total matching the query (for paging). */
export interface ReportPage {
  readonly items: readonly ReportSummary[];
  readonly total: number;
}

// ── Reports & Folders persistence ─────────────────────────────────────────
export interface ReportRepository {
  findBySlug(slug: Slug): Promise<Result<Report | null, AppError>>;
  findById(id: ReportId): Promise<Result<Report | null, AppError>>;
  /** The org's non-deleted reports as summaries, newest first (dashboard list). */
  listByOrg(orgId: OrgId): Promise<Result<readonly ReportSummary[], AppError>>;
  /** Paged + filtered org-wide search (newest first), backed by (org_id, updated_at). */
  searchByOrg(orgId: OrgId, q: ReportSearchQuery): Promise<Result<ReportPage, AppError>>;
  /** Persist the aggregate + any new versions (called inside a UnitOfWork). */
  save(report: Report): Promise<Result<void, AppError>>;
  /** Soft-delete a report (sets deleted_at → the viewer returns 410, ADR-0038).
   * The caller has validated the report exists and is in the actor's org. */
  softDelete(id: ReportId): Promise<Result<void, AppError>>;
}

// The folder tree inside an Org (ADR-0036). Sibling-slug uniqueness is enforced
// by the DB (folders_org_parent_slug_uniq), so save() can surface a conflict.
export interface FolderRepository {
  /** All non-deleted folders for the org — the caller builds the tree. */
  listByOrg(orgId: OrgId): Promise<Result<readonly Folder[], AppError>>;
  findById(id: FolderId): Promise<Result<Folder | null, AppError>>;
  /** Upsert by id — creates a folder, or updates name/slug/parent/deletedAt. */
  save(folder: Folder): Promise<Result<void, AppError>>;
  /** Soft-delete a folder (sets deleted_at). The caller has already validated the
   * folder exists, is in the actor's org, is not Root, and is empty (ADR-0036). */
  softDelete(id: FolderId): Promise<Result<void, AppError>>;
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
  folderId(): FolderId;
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

// ── Identity & Access (ADR-0048: Clerk JIT personal-org provisioning) ────────
/** The authenticated principal as Clerk reports it, before mirroring into our DB. */
export interface ClerkIdentity {
  readonly clerkUserId: string;
  /** The session's active Clerk org, or null when the user has none yet. */
  readonly clerkOrgId: string | null;
  readonly email: string;
}

/** Our mirrored Identity & Access trio: a User, their Org, and that Org's Root folder. */
export interface ProvisionedIdentity {
  readonly userId: UserId;
  readonly orgId: OrgId;
  readonly rootFolderId: FolderId;
}

/**
 * Mirrors a Clerk identity into our `users`/`orgs`/`folders` (ADR-0048). The
 * Drizzle adapter owns the SQL; the in-memory fake backs use-case tests.
 */
export interface IdentityStore {
  /** The mirrored identity for a (Clerk user, Clerk org) pair, or null if not mirrored yet. */
  findByClerk(
    clerkUserId: string,
    clerkOrgId: string,
  ): Promise<Result<ProvisionedIdentity | null, AppError>>;
  /** Create the User + personal Org (Plan `free`) + Root folder for a fresh identity. */
  createPersonalIdentity(input: {
    readonly clerkUserId: string;
    readonly clerkOrgId: string;
    readonly email: string;
    readonly orgName: string;
  }): Promise<Result<ProvisionedIdentity, AppError>>;
}

/**
 * Creates a personal Clerk Organization when the session carries no active org
 * (ADR-0048 — Clerk doesn't auto-create them). Real impl wraps the Clerk backend
 * API (slice 1b); a fake backs the tests.
 */
export interface ClerkOrgProvisioner {
  /** Create a personal org for the user; resolves to the new Clerk org id. */
  createPersonalOrg(clerkUserId: string, name: string): Promise<Result<string, AppError>>;
  /**
   * Resolve the user's existing personal org WITHOUT creating one (read path,
   * ADR-0048): the org the write path would reuse, or null if the user has none.
   * Lets reads see the same org writes attribute to even when the session carries
   * no active org (e.g. a browser sign-in that never selected one).
   */
  findPersonalOrg(clerkUserId: string): Promise<Result<string | null, AppError>>;
}

// ── API keys (ADR-0008 / ADR-0016) — programmatic auth alongside Clerk sessions ─
/**
 * The principal an `arp_` API key resolves to — the same fields the auth seam
 * needs to build an UploadActor. `rootFolderId` is the issuing org's Root folder
 * (the Phase-1 default upload target, ADR-0048); `scopes` come from the key row
 * (ADR-0016), NOT hardcoded like the session path's `reports:write`.
 */
export interface ApiKeyPrincipal {
  readonly userId: UserId;
  readonly orgId: OrgId;
  readonly rootFolderId: FolderId;
  readonly scopes: readonly string[];
}

/** A non-secret view of an issued key, for the management UI. Never carries the secret/hash. */
export interface ApiKeySummary {
  readonly id: string;
  readonly name: string;
  readonly scopes: readonly string[];
  /** The non-secret lookup prefix (e.g. `arp_xxxxxxxx`). */
  readonly keyPrefix: string;
  /** Epoch ms. */
  readonly createdAt: number;
  readonly lastUsedAt: number | null;
  readonly revokedAt: number | null;
}

/**
 * Issues + verifies `arp_` API keys (ADR-0008). The Drizzle adapter owns the SQL
 * + crypto; the seam (`auth.server.ts`) depends only on this port, so API keys
 * and Clerk sessions stay interchangeable behind one resolution contract.
 */
export interface ApiKeyStore {
  /**
   * Resolve a presented token to its principal, or null when no LIVE (non-revoked)
   * key matches. Bumps `last_used_at` on a hit. The hash compare is constant-time.
   */
  verify(token: string): Promise<Result<ApiKeyPrincipal | null, AppError>>;
  /** Mint a key for (user, org); returns the one-time secret plus its summary. */
  create(input: {
    readonly actingUserId: UserId;
    readonly issuedInOrgId: OrgId;
    readonly name: string;
    readonly scopes: readonly string[];
  }): Promise<Result<{ readonly token: string; readonly summary: ApiKeySummary }, AppError>>;
  /** List a user's issued keys, newest first (management UI). */
  listForUser(actingUserId: UserId): Promise<Result<readonly ApiKeySummary[], AppError>>;
  /** Revoke a key the user owns (idempotent: re-revoking is a no-op). */
  revoke(id: string, actingUserId: UserId): Promise<Result<void, AppError>>;
}
