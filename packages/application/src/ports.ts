// Driven ports for the Phase 1 use cases (hexagonal, ADR-0020). Use cases
// depend on these interfaces; Drizzle/R2 adapters implement them (1c.3) and
// in-memory fakes (./testing) back the use-case unit tests (ADR-0019 keeps the
// real e2e on real infra; these fakes are for fast use-case TDD only).
//
// Fallible I/O returns Promise<Result<T, AppError>> so failures thread through
// the functional pipeline (ADR-0024) instead of throwing. Pure services
// (ids/slug/clock) return plain values for deterministic tests.

import type {
  Acl,
  AppError,
  ClerkOrgId,
  ClerkUserId,
  Comment,
  CommentId,
  DomainEvent,
  Folder,
  FolderId,
  OrgId,
  OrgKind,
  Report,
  ReportId,
  Result,
  ScanStatus,
  Slug,
  TerminalScanStatus,
  UserId,
  VersionId,
  VersionOrigin,
} from "arp-domain";
import type { AuditEntry } from "./audit";

/**
 * A lightweight read projection of a Report for list views (the dashboard).
 * Deliberately NOT the full aggregate — listing must not load every version's
 * manifest. `isPublished` = a clean version is live (vs still pending). A richer
 * per-version status badge (e.g. flagged) is a follow-up. `folderId` lets the UI
 * group reports under their folder in the tree.
 */
export interface ReportSummary {
  readonly id: ReportId;
  readonly slug: Slug;
  readonly title: string;
  readonly isPublished: boolean;
  readonly folderId: FolderId;
}

/** Cursor pagination params (ADR-0053): keyset on the entity's UUIDv7 id, DESC
 *  (newest-created first). `startingAfter`/`endingBefore` are exclusive id bounds. */
export interface CursorParams<Id> {
  readonly limit: number;
  readonly startingAfter?: Id;
  readonly endingBefore?: Id;
}

export interface ReportSearchQuery extends CursorParams<ReportId> {
  /** Case-insensitive substring matched against title + slug. Omitted = no filter. */
  readonly query?: string;
  /** Restrict to one folder. Omitted = org-wide (across all folders). */
  readonly folderId?: FolderId;
}

/** Cursor-paginated query over an org's folder tree (ADR-0053). */
export type FolderListQuery = CursorParams<FolderId>;

/** A cursor-paginated slice (ADR-0053): the page items + whether more follow. */
export interface CursorPage<T> {
  readonly items: readonly T[];
  readonly hasMore: boolean;
}
export type ReportPage = CursorPage<ReportSummary>;
export type FolderPage = CursorPage<Folder>;

/**
 * A lightweight read projection of a ReportVersion for the version-history list
 * (ADR-0065) — deliberately NOT the full `ReportVersion` (no manifest/content
 * hash), mirroring `ReportSummary`'s "lean projection, not the full aggregate"
 * pattern. `uploadedAt` is a DB-stamped audit fact (like `reports.created_at`),
 * which is why it lives here rather than on the pure domain `ReportVersion`.
 */
export interface ReportVersionSummary {
  readonly id: VersionId;
  readonly versionNo: number;
  readonly uploadedBy: UserId;
  readonly uploadedAt: number; // epoch ms
  readonly scanStatus: ScanStatus;
  readonly sizeBytes: number;
  readonly origin: VersionOrigin;
}
export type VersionPage = CursorPage<ReportVersionSummary>;

// ── Reports & Folders persistence ─────────────────────────────────────────
export interface ReportRepository {
  findBySlug(slug: Slug): Promise<Result<Report | null, AppError>>;
  findById(id: ReportId): Promise<Result<Report | null, AppError>>;
  /** The org's non-deleted reports as summaries, newest first (dashboard list). */
  listByOrg(orgId: OrgId): Promise<Result<readonly ReportSummary[], AppError>>;
  /** Cursor-paginated + filtered org-wide search (newest-created first), keyset on
   *  the report id (ADR-0053). */
  searchByOrg(orgId: OrgId, q: ReportSearchQuery): Promise<Result<ReportPage, AppError>>;
  /** Persist the aggregate + any new versions (called inside a UnitOfWork). */
  save(report: Report): Promise<Result<void, AppError>>;
  /** Soft-delete a report (sets deleted_at → the viewer returns 410, ADR-0038).
   * The caller has validated the report exists and is in the actor's org. */
  softDelete(id: ReportId): Promise<Result<void, AppError>>;
  /** Upsert the report's `Acl` (ADR-0056) into the 1:1 `acls` row. The caller has
   *  validated org ownership + the `acl:write` scope and hashed any password. */
  setAcl(id: ReportId, acl: Acl): Promise<Result<void, AppError>>;
  /** Cursor-paginated version history for one report (newest-created first),
   *  keyset on the version id (ADR-0053, ADR-0065). The caller has already
   *  validated the report's existence + org ownership (loadOwnedReport). */
  listVersions(
    reportId: ReportId,
    q: CursorParams<VersionId>,
  ): Promise<Result<VersionPage, AppError>>;
}

// ── Authoring & Collaboration (ADR-0064) ───────────────────────────────────
export type CommentPage = CursorPage<Comment>;

/** Persists the `Comment` aggregate (ADR-0020 repository pattern, ADR-0064). One
 *  row per comment (root or reply) — `Comment` itself is already the lean shape
 *  (no separate summary projection needed, unlike ReportSummary/ReportVersionSummary). */
export interface CommentRepository {
  findById(id: CommentId): Promise<Result<Comment | null, AppError>>;
  /** Upsert by id (create on first save; resolve/other transitions re-save). */
  save(comment: Comment): Promise<Result<void, AppError>>;
  /** Cursor-paginated comments for one report (newest-created first, ADR-0053),
   *  keyset on the comment id. Includes both roots and replies — the caller
   *  threads them into Threads client-side via `parentCommentId`. */
  listByReport(
    reportId: ReportId,
    q: CursorParams<CommentId>,
  ): Promise<Result<CommentPage, AppError>>;
  /** Hard-delete a comment (and, via the DB's self-FK CASCADE, its replies when
   *  it's a root — ADR-0064, schema.ts's FK-policy note). */
  delete(id: CommentId): Promise<Result<void, AppError>>;
}

/**
 * Password hashing for `password`-mode ACLs (ADR-0056, argon2id). I/O lives in the
 * adapter; the `setAcl` use case hashes a new password, the viewer-auth endpoint
 * verifies a submitted one against the stored hash.
 */
export interface PasswordHasher {
  hash(plaintext: string): Promise<Result<string, AppError>>;
  verify(plaintext: string, hash: string): Promise<Result<boolean, AppError>>;
}

/** A transactional email to send (ADR-0056/0057). HTML is required; `text` is an
 *  optional plain-text fallback. The From address is adapter config, not per-message. */
export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text?: string;
}

/**
 * Outbound transactional email (ADR-0057, Resend). The only sender right now is the
 * `allowlist` magic link. I/O lives in the adapter; use cases depend on this port and
 * are tested with a capturing fake. Fail-open at the composition root (no key ⇒ omitted).
 */
export interface EmailSender {
  send(message: EmailMessage): Promise<Result<void, AppError>>;
}

/**
 * Single-use, TTL-bounded key→value store for the `allowlist` magic-link nonce
 * (ADR-0056, backed by Upstash Redis / ADR-0011). The use case stores `{slug,email}`
 * under a fresh id on send, and `take`s it on redeem — `take` is an **atomic
 * get-and-delete** (Redis GETDEL), so a nonce works exactly once.
 */
export interface NonceStore {
  put(id: string, value: string, ttlSeconds: number): Promise<Result<void, AppError>>;
  /** Atomically read + delete; null when absent / expired / already consumed. */
  take(id: string): Promise<Result<string | null, AppError>>;
}

/**
 * Durable, revocable access grants for `allowlist` mode (ADR-0056, revocation-C).
 * Created on magic-link redeem; the viewer checks a **live** grant per request, so
 * removing an allowlisted email (or switching mode) revokes immediately — the next
 * request denies. Distinct from the stateless ~15-min token `password` mode uses.
 * Emails are matched **normalized** (trimmed + lowercased, like the `Acl` allowlist) —
 * the store does this defensively, so callers needn't pre-normalize.
 */
export interface GrantStore {
  /** Create or refresh a grant for (report, email) expiring at `expiresAtMs`. */
  grant(reportId: ReportId, email: string, expiresAtMs: number): Promise<Result<void, AppError>>;
  /** Whether a **live** (non-expired) grant exists for (report, email). */
  isGranted(reportId: ReportId, email: string): Promise<Result<boolean, AppError>>;
  /** Revoke a single grant — an email removed from the allowlist. */
  revoke(reportId: ReportId, email: string): Promise<Result<void, AppError>>;
  /** Revoke every grant for a report — mode switched away from allowlist. */
  revokeAll(reportId: ReportId): Promise<Result<void, AppError>>;
}

/**
 * A per-report write grant (ADR-0060) — the owner-granted permission to rename,
 * re-upload, or move a specific report. No surrogate id (wire-addressed as
 * `(slug, email)`); no expiry (persists until revoked); one implicit level.
 */
export interface WriteGrant {
  readonly reportId: ReportId;
  /** Normalized (`EmailAddress`) — the canonical key alongside `reportId`. */
  readonly granteeEmail: string;
  /** Resolved lazily: set opportunistically at grant time when the user already
   *  exists, else null and matched by email at check time. */
  readonly granteeUserId: UserId | null;
  readonly grantedBy: UserId;
  /** Epoch ms. */
  readonly grantedAt: number;
}

/**
 * Durable per-report write grants (ADR-0060) over `report_write_grants`.
 * Modeled on `GrantStore` — email-keyed, upsert-in-place, revoke-by-row-delete.
 * Unlike `GrantStore` there is no expiry and no view-access semantics; this
 * store backs the `canWrite` seam's `hasWriteGrant` check (rename/re-upload/
 * move), which works cross-org. Emails are matched **normalized**; the store
 * does this defensively so callers needn't pre-normalize.
 */
export interface WriteGrantStore {
  /** Create or refresh a grant for (report, email). `granteeUserId` is the
   *  opportunistic resolution at grant time (null when the grantee hasn't
   *  signed up yet). */
  grant(
    reportId: ReportId,
    email: string,
    grantedBy: UserId,
    granteeUserId: UserId | null,
  ): Promise<Result<void, AppError>>;
  /** Revoke a single grantee's write access. */
  revoke(reportId: ReportId, email: string): Promise<Result<void, AppError>>;
  /** Every write grant on a report (owner-only listing). */
  listByReport(reportId: ReportId): Promise<Result<readonly WriteGrant[], AppError>>;
  /**
   * Whether `actor` holds a write grant on `reportId` — matched by
   * `granteeUserId = actor.userId` OR normalized-email equality with
   * `actor.email` (ADR-0060 §2: the grantee may not have signed up at grant
   * time, so email is the durable match key). `email` is omitted when the
   * caller couldn't resolve one (never happens for a real signed-in actor).
   */
  findFor(
    reportId: ReportId,
    actor: { readonly userId: UserId; readonly email?: string },
  ): Promise<Result<WriteGrant | null, AppError>>;
}

// The folder tree inside an Org (ADR-0036). Sibling-slug uniqueness is enforced
// by the DB (folders_org_parent_slug_uniq), so save() can surface a conflict.
export interface FolderRepository {
  /** All non-deleted folders for the org — the caller builds the tree. */
  listByOrg(orgId: OrgId): Promise<Result<readonly Folder[], AppError>>;
  /** Cursor-paginated non-deleted folders (ADR-0053), keyset on id DESC. */
  searchByOrg(orgId: OrgId, q: FolderListQuery): Promise<Result<FolderPage, AppError>>;
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

// ── Audit log (ADR-0070, issue #153) ──────────────────────────────────────
export interface AuditLogger {
  /** Append audit rows in the same transaction as the state change (ADR-0070). */
  record(entries: readonly AuditEntry[]): Promise<Result<void, AppError>>;
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
  /** ADR-0064 (Authoring & Collaboration) — new `Comment` aggregate ids. */
  commentId(): CommentId;
  /** An opaque, unguessable id for a magic-link nonce (ADR-0056); not a domain id.
   *  Unforgeability rests on the link's HMAC + the store's single-use GETDEL, not on
   *  this id's entropy, so a time-ordered uuidv7 is sufficient. */
  nonceId(): string;
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
  readonly clerkUserId: ClerkUserId;
  /** The session's active Clerk org, or null when the user has none yet. */
  readonly clerkOrgId: ClerkOrgId | null;
  readonly email: string;
  /** The user's human display name as Clerk reports it (ADR-0063 author display) —
   *  `fullName` / `firstName lastName` / `username`, whichever the adapter could
   *  resolve, else null. Captured at JIT provisioning alongside the email; a
   *  best-effort attribute (the wire falls back to email, then a generic label). */
  readonly displayName: string | null;
}

/**
 * A mirrored user's display identity — email + optional human name — resolved by
 * internal `UserId` for author display (ADR-0063). Distinct from the write-grant
 * `findEmailByUserId` seam: this one also carries the `displayName` column so the
 * comments/versions list routes can surface a human name (falling back to email).
 */
export interface AuthorIdentity {
  readonly email: string;
  readonly displayName: string | null;
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
  /**
   * Our internal `OrgId` for a mirrored Clerk org, or null when the org isn't
   * mirrored. The org-mode unlock decision (ADR-0056 P2) needs ONLY this:
   * membership is asserted by the Clerk-verified session org — requiring a
   * mirrored `users` row would wrongly deny members who have never written
   * (the users row is created on the write path, review #150 H-1).
   */
  findOrgByClerkOrgId(clerkOrgId: string): Promise<Result<OrgId | null, AppError>>;
  /**
   * Create the User + Org (Plan `free`) + Root folder for a fresh identity, OR —
   * when `clerkOrgId` already names an existing mirrored Org (a domain's team org
   * a new colleague is JIT-joining, ADR-0068 §3) — join it: the Org insert is a
   * find-or-create keyed on `clerkOrgId` (existing Org row wins; `kind` is set
   * only on first creation), while the User row is always find-or-created for
   * THIS call's `clerkUserId`. `kind` records which the CALLER already resolved
   * via `resolveOrgKey` (ADR-0068 §1) — this port does not re-derive it. Renamed
   * from `createPersonalIdentity` (ADR-0068): it now covers BOTH the original
   * personal-org creation and a team-org join, same mirroring mechanics.
   * MUST refuse to resurrect a soft-deleted user (ADR-0054 — deletion is terminal).
   */
  createIdentity(input: {
    readonly clerkUserId: string;
    readonly clerkOrgId: string;
    readonly email: string;
    /** The user's human display name at first sight (ADR-0063), or null when Clerk
     *  exposes none. Stored on the mirrored `users` row; refreshed (never nulled)
     *  on a re-provision so a name captured later still lands. */
    readonly displayName: string | null;
    readonly orgName: string;
    readonly kind: OrgKind;
  }): Promise<Result<ProvisionedIdentity, AppError>>;
  /**
   * Soft-delete our mirrored user (stamp `deleted_at`) for a Clerk `user.deleted`
   * (ADR-0054). Returns the affected `UserId` (so the caller can cascade), or null
   * when no LIVE user matched — idempotent: replays / unknown ids are a no-op.
   */
  softDeleteByClerkId(clerkUserId: string): Promise<Result<UserId | null, AppError>>;
  /**
   * The mirrored user's email, by our internal `UserId` (ADR-0060 §2 — the
   * `canWrite` seam's write-grant matching needs the ACTING user's email to
   * compare against a grant's `grantee_email` when `grantee_user_id` is still
   * null). Reuses the mirrored `users` row rather than a live Clerk lookup —
   * no extra external round-trip on every write/read check. Null when the
   * user id is unknown (shouldn't happen for a resolved actor).
   */
  findEmailByUserId(userId: UserId): Promise<Result<string | null, AppError>>;
  /**
   * The mirrored user's display identity — email + optional `displayName` — by
   * internal `UserId`, for author display (ADR-0063). One query resolves both
   * columns (batch-friendly, mirroring `findEmailByUserId`'s single round-trip).
   * Null when the user is unknown OR soft-deleted (same PII posture as
   * `findEmailByUserId`: a since-deleted author must not leak name/email into the
   * comments/versions author surfaces). `displayName` is null when none is stored.
   */
  findAuthorIdentityByUserId(userId: UserId): Promise<Result<AuthorIdentity | null, AppError>>;
  /**
   * Our internal `UserId` for an already-mirrored user with this email, or
   * null if none exists yet (ADR-0060 §2 — `grantWrite`'s opportunistic
   * `grantee_user_id` resolution: set it now if the grantee already has an
   * account, else leave it null and match by email at check time).
   */
  findUserIdByEmail(email: string): Promise<Result<UserId | null, AppError>>;
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
   * no active org (e.g. a browser sign-in that never selected one). Under the
   * one-user-one-org invariant (ADR-0068 §1) this ALSO resolves a team-org
   * member's sole org — the name predates team orgs but the mechanics (oldest
   * membership, read-only) are kind-agnostic.
   */
  findPersonalOrg(clerkUserId: string): Promise<Result<string | null, AppError>>;
  /**
   * Resolve an EXISTING team org for a corporate email domain (ADR-0068 §3), or
   * null when nobody at that domain has signed up yet. The adapter derives
   * whatever Clerk-specific identifier it needs (e.g. a slug) FROM `domain`
   * internally — this port speaks in plain email domains, not Clerk slugs.
   * Read-only — never creates (mirrors `findPersonalOrg`'s read/write split).
   */
  findTeamOrgByDomain(domain: string): Promise<Result<string | null, AppError>>;
  /**
   * Create a brand-new team org for a corporate domain (ADR-0068 §3) — the
   * FIRST sign-up at that domain. `domain` is both the org's display name and
   * the input to the adapter's deterministic Clerk-identifier derivation (so a
   * later joiner's `findTeamOrgByDomain` finds this same org). Resolves to the
   * new Clerk org id.
   */
  createTeamOrg(domain: string, createdBy: string): Promise<Result<string, AppError>>;
  /**
   * Add `clerkUserId` as a member of an EXISTING Clerk org (ADR-0068 §3 — every
   * sign-up after a team org's first joins this way). Idempotent: an
   * already-a-member user is a no-op success, not an error (concurrency-safe
   * like `createPersonalOrg`'s check-then-act dedupe).
   */
  ensureMembership(clerkOrgId: string, clerkUserId: string): Promise<Result<void, AppError>>;
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
  /**
   * Revoke ALL of a user's live keys (the user-soft-delete cascade, ADR-0054).
   * Returns the count revoked; idempotent — already-revoked keys are skipped.
   */
  revokeAllForUser(actingUserId: UserId): Promise<Result<number, AppError>>;
}
