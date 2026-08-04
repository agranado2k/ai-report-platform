// In-memory fakes for the driven ports — fast, deterministic substrate for
// use-case unit tests (1d+). NOT for production and NOT a substitute for the
// real-infra e2e (ADR-0019); they just let the functional use cases be TDD'd
// without Neon/R2.

import {
  type Acl,
  type AppError,
  type Comment,
  type CommentId,
  conflict,
  type DomainEvent,
  err,
  type Folder,
  type FolderId,
  isFolderBroadlyVisibleTo,
  commentId as makeCommentId,
  folderId as makeFolderId,
  orgId as makeOrgId,
  reportId as makeReportId,
  makeSlug,
  userId as makeUserId,
  versionId as makeVersionId,
  normalizeEmailAddress,
  notAllowed,
  type OrgId,
  type OrgKind,
  ok,
  type Report,
  type ReportId,
  type Result,
  type Slug,
  type TerminalScanStatus,
  type UserId,
  type VersionId,
  validationError,
} from "arp-domain";
import type { AuditEntry } from "../audit";
import type {
  ApiKeyPrincipal,
  ApiKeyStore,
  ApiKeySummary,
  AuditLogger,
  AuthorIdentity,
  BlobFile,
  BlobStore,
  BundleProcessor,
  ClerkOrgProvisioner,
  Clock,
  CommentPage,
  CommentRepository,
  CursorParams,
  EmailMessage,
  EmailSender,
  EventOutbox,
  FolderListQuery,
  FolderPage,
  FolderRepository,
  FolderShare,
  FolderShareStore,
  FolderViewer,
  GrantStore,
  Hasher,
  IdempotencyBegin,
  IdempotencyKeyRef,
  IdempotencyRecord,
  IdempotencyStore,
  IdentityStore,
  IdGenerator,
  NonceStore,
  OrgWriteGrant,
  OrgWriteGrantStore,
  PasswordHasher,
  PlanLimiter,
  ProcessedBundle,
  ProvisionedIdentity,
  ReportPage,
  ReportRepository,
  ReportSearchQuery,
  ReportVersionSummary,
  ReportViewer,
  ScanJobMessage,
  ScanQueue,
  ScanRequest,
  ScanWorkQueue,
  SlugFactory,
  UnitOfWork,
  VersionPage,
  WriteGrant,
  WriteGrantStore,
} from "../ports";

/** In-memory keyset paginator (ADR-0053) over id DESC (newest-created first),
 *  mirroring the adapters' `WHERE id < :after / > :before ORDER BY id DESC` query. */
function keysetPage<T extends { readonly id: string }>(
  all: readonly T[],
  q: { readonly limit: number; readonly startingAfter?: string; readonly endingBefore?: string },
): { items: readonly T[]; hasMore: boolean } {
  const sorted = [...all].sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  if (q.startingAfter) {
    const i = sorted.findIndex((x) => x.id === q.startingAfter);
    const pool = i >= 0 ? sorted.slice(i + 1) : [];
    return { items: pool.slice(0, q.limit), hasMore: pool.length > q.limit };
  }
  if (q.endingBefore) {
    const i = sorted.findIndex((x) => x.id === q.endingBefore);
    const pool = i >= 0 ? sorted.slice(0, i) : [];
    // the `limit` items immediately before the cursor (closest to it)
    return {
      items: pool.slice(Math.max(0, pool.length - q.limit)),
      hasMore: pool.length > q.limit,
    };
  }
  return { items: sorted.slice(0, q.limit), hasMore: sorted.length > q.limit };
}

export class InMemoryFolderRepository implements FolderRepository, TxSnapshottable {
  private readonly byId = new Map<string, Folder>();

  /** `shares` backs the ADR-0076 visibility predicate's share leg — share the
   *  SAME store instance the test shares through. Omitted = the share leg
   *  never matches (fine for tests not exercising folder shares). */
  constructor(private readonly shares?: FolderShareStore) {}

  /** The ADR-0076 folder visibility predicate — mirrors the adapter's SQL:
   *  owner OR legacy (ownerId null) OR org-visible OR shared with the viewer
   *  (userId-or-email match, ADR-0060 §2). Anything else is invisible —
   *  existence is private. */
  private async isVisibleTo(f: Folder, viewer: FolderViewer): Promise<boolean> {
    if (isFolderBroadlyVisibleTo(f, viewer.userId)) return true;
    if (!this.shares) return false;
    const share = await this.shares.findFor(f.id, {
      userId: viewer.userId,
      email: viewer.email,
    });
    return share.ok && share.value !== null;
  }

  private async visibleForOrg(orgId: OrgId, viewer: FolderViewer): Promise<readonly Folder[]> {
    const live = [...this.byId.values()].filter((f) => f.orgId === orgId && f.deletedAt === null);
    const visible: Folder[] = [];
    for (const f of live) {
      if (await this.isVisibleTo(f, viewer)) visible.push(f);
    }
    return visible;
  }

  async listByOrg(
    orgId: OrgId,
    viewer: FolderViewer,
  ): Promise<Result<readonly Folder[], AppError>> {
    return ok(await this.visibleForOrg(orgId, viewer));
  }

  async searchByOrg(
    orgId: OrgId,
    viewer: FolderViewer,
    q: FolderListQuery,
  ): Promise<Result<FolderPage, AppError>> {
    return ok(keysetPage(await this.visibleForOrg(orgId, viewer), q));
  }

  async hasChildFolders(orgId: OrgId, folderId: FolderId): Promise<Result<boolean, AppError>> {
    // The deleteFolder emptiness guard — org-scoped, NOT visibility-scoped
    // (ADR-0076): an invisible subfolder must still block the delete.
    return ok(
      [...this.byId.values()].some(
        (f) => f.orgId === orgId && f.parentId === folderId && f.deletedAt === null,
      ),
    );
  }

  async findById(id: FolderId): Promise<Result<Folder | null, AppError>> {
    return ok(this.byId.get(id) ?? null);
  }

  async save(folder: Folder): Promise<Result<void, AppError>> {
    // Mimic the DB sibling-slug uniqueness (folders_org_parent_slug_uniq).
    const clash = [...this.byId.values()].some(
      (f) =>
        f.id !== folder.id &&
        f.deletedAt === null &&
        f.orgId === folder.orgId &&
        f.parentId === folder.parentId &&
        f.slug === folder.slug,
    );
    if (clash) {
      return err(validationError(`a folder '${folder.slug}' already exists here`, "name"));
    }
    this.byId.set(folder.id, folder);
    return ok(undefined);
  }

  async softDelete(id: FolderId): Promise<Result<void, AppError>> {
    const f = this.byId.get(id);
    if (f) this.byId.set(id, { ...f, deletedAt: 1 });
    return ok(undefined);
  }

  snapshot(): unknown {
    return new Map(this.byId);
  }

  restore(snapshot: unknown): void {
    restoreMap(this.byId, snapshot as Map<string, Folder>);
  }
}

export class InMemoryReportRepository implements ReportRepository, TxSnapshottable {
  private readonly byId = new Map<string, Report>();
  private readonly slugToId = new Map<string, string>();
  // Version `uploaded_at` is DB-stamped (defaultNow()), not part of the pure
  // domain ReportVersion — mirrors the real adapter's INSERT-time timestamp: a
  // version id gets its stamp once, on first save, and keeps it across re-saves
  // (a scan-status refresh does not touch uploaded_at, same as the real upsert).
  private readonly versionUploadedAt = new Map<string, number>();
  private uploadSeq = 0;

  /** `writeGrants` backs the ADR-0075 visibility predicate's grant leg and
   *  `orgWriteGrants` the ADR-0078 org-write leg — share the SAME store
   *  instances the test grants through. Omitted = that leg never matches (fine
   *  for tests not exercising grants). `viewerOrgId` is the org the org-write
   *  leg matches against; the fake has no report→org join to consult, and the
   *  real adapter's SQL restricts to the searched org anyway. */
  constructor(
    private readonly writeGrants?: WriteGrantStore,
    private readonly orgWriteGrants?: OrgWriteGrantStore,
    private readonly viewerOrgId?: OrgId,
  ) {}

  async findBySlug(slug: Slug): Promise<Result<Report | null, AppError>> {
    const id = this.slugToId.get(slug);
    return ok(id ? (this.byId.get(id) ?? null) : null);
  }

  async findById(id: ReportId): Promise<Result<Report | null, AppError>> {
    return ok(this.byId.get(id) ?? null);
  }

  /** The ADR-0075 visibility predicate — mirrors the adapter's SQL: owned OR
   *  broadly shared (`org`/`public`) OR write-granted (userId-or-email match,
   *  ADR-0060 §2) OR org-write-granted (ADR-0078 §8). Anything else is
   *  invisible — existence is private. */
  private async isVisibleTo(r: Report, viewer: ReportViewer): Promise<boolean> {
    if (r.ownerId === viewer.userId) return true;
    if (r.acl.mode === "org" || r.acl.mode === "public") return true;
    if (this.writeGrants) {
      const grant = await this.writeGrants.findFor(r.id, {
        userId: viewer.userId,
        email: viewer.email,
      });
      if (grant.ok && grant.value !== null) return true;
    }
    // ADR-0078 §8: an org-write row lists the report for members of the org it
    // was issued for, even if the acl never made it broadly readable (a
    // combination only the API can produce — see the contract matrix).
    if (this.orgWriteGrants) {
      const orgGrant = await this.orgWriteGrants.find(r.id);
      if (orgGrant.ok && orgGrant.value !== null) {
        return orgGrant.value.orgId === (this.viewerOrgId ?? r.orgId);
      }
    }
    return false;
  }

  async searchByOrg(
    orgId: OrgId,
    viewer: ReportViewer,
    q: ReportSearchQuery,
  ): Promise<Result<ReportPage, AppError>> {
    const needle = q.query?.trim().toLowerCase();
    const matched = [...this.byId.values()]
      .filter((r) => r.orgId === orgId && r.deletedAt === null)
      .filter((r) => (q.folderId ? r.folderId === q.folderId : true))
      .filter((r) =>
        needle
          ? r.title.toLowerCase().includes(needle) || r.slug.toLowerCase().includes(needle)
          : true,
      );
    const visible: Report[] = [];
    for (const r of matched) {
      if (await this.isVisibleTo(r, viewer)) visible.push(r);
    }
    const { items, hasMore } = keysetPage(visible, q); // keyset on id DESC (ADR-0053)
    return ok({
      items: items.map((r) => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        isPublished: r.liveVersionId !== null,
        folderId: r.folderId,
      })),
      hasMore,
    });
  }

  async hasReportsInFolder(orgId: OrgId, folderId: FolderId): Promise<Result<boolean, AppError>> {
    // The deleteFolder emptiness guard — org-scoped, NOT visibility-scoped
    // (ADR-0075): an invisible report must still block the delete.
    return ok(
      [...this.byId.values()].some(
        (r) => r.orgId === orgId && r.folderId === folderId && r.deletedAt === null,
      ),
    );
  }

  async save(report: Report): Promise<Result<void, AppError>> {
    this.byId.set(report.id, report);
    this.slugToId.set(report.slug, report.id);
    for (const v of report.versions) {
      if (!this.versionUploadedAt.has(v.id)) {
        this.uploadSeq += 1;
        this.versionUploadedAt.set(v.id, this.uploadSeq);
      }
    }
    return ok(undefined);
  }

  async softDelete(id: ReportId): Promise<Result<void, AppError>> {
    const r = this.byId.get(id);
    if (r) this.byId.set(id, { ...r, deletedAt: 1 });
    return ok(undefined);
  }

  async setAcl(id: ReportId, acl: Acl): Promise<Result<void, AppError>> {
    const r = this.byId.get(id);
    if (r) this.byId.set(id, { ...r, acl });
    return ok(undefined);
  }

  async listVersions(
    reportId: ReportId,
    q: CursorParams<VersionId>,
  ): Promise<Result<VersionPage, AppError>> {
    const report = this.byId.get(reportId);
    const summaries: ReportVersionSummary[] = (report?.versions ?? []).map((v) => ({
      id: v.id,
      versionNo: v.versionNo,
      uploadedBy: v.uploadedBy,
      uploadedAt: this.versionUploadedAt.get(v.id) ?? 0,
      scanStatus: v.scanStatus,
      sizeBytes: v.sizeBytes,
      origin: v.origin,
    }));
    return ok(keysetPage(summaries, q));
  }

  snapshot(): unknown {
    return {
      byId: new Map(this.byId),
      slugToId: new Map(this.slugToId),
      versionUploadedAt: new Map(this.versionUploadedAt),
      uploadSeq: this.uploadSeq,
    };
  }

  restore(snapshot: unknown): void {
    const s = snapshot as {
      byId: Map<string, Report>;
      slugToId: Map<string, string>;
      versionUploadedAt: Map<string, number>;
      uploadSeq: number;
    };
    restoreMap(this.byId, s.byId);
    restoreMap(this.slugToId, s.slugToId);
    restoreMap(this.versionUploadedAt, s.versionUploadedAt);
    this.uploadSeq = s.uploadSeq;
  }
}

/** Overwrite `target`'s contents with `source`'s (rollback restore helper). */
function restoreMap<K, V>(target: Map<K, V>, source: ReadonlyMap<K, V>): void {
  target.clear();
  for (const [k, v] of source) target.set(k, v);
}

/** In-memory CommentRepository (ADR-0064). `delete` mirrors the real adapter's
 *  self-FK CASCADE: deleting a root also deletes its replies. */
export class InMemoryCommentRepository implements CommentRepository, TxSnapshottable {
  private readonly byId = new Map<string, Comment>();

  async findById(id: CommentId): Promise<Result<Comment | null, AppError>> {
    return ok(this.byId.get(id) ?? null);
  }

  async save(comment: Comment): Promise<Result<void, AppError>> {
    this.byId.set(comment.id, comment);
    return ok(undefined);
  }

  async listByReport(
    reportId: ReportId,
    q: CursorParams<CommentId>,
  ): Promise<Result<CommentPage, AppError>> {
    const matched = [...this.byId.values()].filter((c) => c.reportId === reportId);
    return ok(keysetPage(matched, q));
  }

  async delete(id: CommentId): Promise<Result<void, AppError>> {
    this.byId.delete(id);
    // Self-FK CASCADE (schema.ts's comments.parent_comment_id): deleting a root
    // deletes its replies too.
    for (const c of [...this.byId.values()]) {
      if (c.parentCommentId === id) this.byId.delete(c.id);
    }
    return ok(undefined);
  }

  snapshot(): unknown {
    return new Map(this.byId);
  }

  restore(snapshot: unknown): void {
    restoreMap(this.byId, snapshot as Map<string, Comment>);
  }
}

const blobKey = (reportId: ReportId, versionId: VersionId, path: string) =>
  `${reportId}/${versionId}/${path}`;

export class InMemoryBlobStore implements BlobStore {
  private readonly objects = new Map<string, BlobFile>();

  async putVersionBundle(
    reportId: ReportId,
    versionId: VersionId,
    files: readonly BlobFile[],
  ): Promise<Result<void, AppError>> {
    for (const f of files) this.objects.set(blobKey(reportId, versionId, f.path), f);
    return ok(undefined);
  }

  async readObject(
    reportId: ReportId,
    versionId: VersionId,
    path: string,
  ): Promise<Result<BlobFile | null, AppError>> {
    return ok(this.objects.get(blobKey(reportId, versionId, path)) ?? null);
  }

  async deleteVersionPrefix(
    reportId: ReportId,
    versionId: VersionId,
  ): Promise<Result<void, AppError>> {
    const prefix = `${reportId}/${versionId}/`;
    for (const k of [...this.objects.keys()]) if (k.startsWith(prefix)) this.objects.delete(k);
    return ok(undefined);
  }
}

const idemKey = (ref: IdempotencyKeyRef) => `${ref.actingUserId}|${ref.route}|${ref.key}`;

interface IdemEntry {
  readonly fingerprint: string;
  readonly state: "in_flight" | "completed";
  readonly record?: IdempotencyRecord;
}

export class InMemoryIdempotencyStore implements IdempotencyStore, TxSnapshottable {
  private readonly entries = new Map<string, IdemEntry>();

  async begin(
    ref: IdempotencyKeyRef,
    fingerprint: string,
  ): Promise<Result<IdempotencyBegin, AppError>> {
    const k = idemKey(ref);
    const existing = this.entries.get(k);
    if (!existing) {
      this.entries.set(k, { fingerprint, state: "in_flight" });
      return ok({ outcome: "proceed" });
    }
    if (existing.fingerprint !== fingerprint) {
      return err({
        kind: "IdempotencyKeyReuseDifferentBody",
        message: "idempotency key reused with a different request",
      });
    }
    if (existing.state === "completed" && existing.record) {
      return ok({ outcome: "replay", record: existing.record });
    }
    return ok({ outcome: "in_flight" });
  }

  async complete(
    ref: IdempotencyKeyRef,
    record: IdempotencyRecord,
  ): Promise<Result<void, AppError>> {
    const k = idemKey(ref);
    const existing = this.entries.get(k);
    if (!existing) {
      // complete() without a prior begin() is a contract violation — fail loud
      // in tests rather than create a ghost entry (immutable update otherwise).
      throw new Error(`InMemoryIdempotencyStore: complete() called without begin() for key ${k}`);
    }
    this.entries.set(k, { ...existing, state: "completed", record });
    return ok(undefined);
  }

  snapshot(): unknown {
    return new Map(this.entries);
  }

  restore(snapshot: unknown): void {
    restoreMap(this.entries, snapshot as Map<string, IdemEntry>);
  }
}

export class InMemoryEventOutbox implements EventOutbox, TxSnapshottable {
  private readonly events: DomainEvent[] = [];

  async enqueue(events: readonly DomainEvent[]): Promise<Result<void, AppError>> {
    this.events.push(...events);
    return ok(undefined);
  }

  /** Test helper: the events enqueued so far (in order). */
  drained(): readonly DomainEvent[] {
    return [...this.events];
  }

  snapshot(): unknown {
    return [...this.events];
  }

  restore(snapshot: unknown): void {
    this.events.length = 0;
    this.events.push(...(snapshot as DomainEvent[]));
  }
}

export class InMemoryAuditLogger implements AuditLogger, TxSnapshottable {
  private readonly entries: AuditEntry[] = [];

  async record(entries: readonly AuditEntry[]): Promise<Result<void, AppError>> {
    this.entries.push(...entries);
    return ok(undefined);
  }

  /** Test helper: the entries recorded so far (in order). */
  recorded(): readonly AuditEntry[] {
    return [...this.entries];
  }

  snapshot(): unknown {
    return [...this.entries];
  }

  restore(snapshot: unknown): void {
    this.entries.length = 0;
    this.entries.push(...(snapshot as AuditEntry[]));
  }
}

export class RecordingScanQueue implements ScanQueue {
  readonly enqueued: Array<{ readonly reportId: ReportId; readonly versionId: VersionId }> = [];
  readonly running: VersionId[] = [];
  readonly completed: Array<{
    readonly versionId: VersionId;
    readonly verdict: TerminalScanStatus;
  }> = [];
  /** Test-settable: the rows listQueued returns (the reconcile work list). */
  queuedList: ScanRequest[] = [];

  async enqueueScan(reportId: ReportId, versionId: VersionId): Promise<Result<void, AppError>> {
    this.enqueued.push({ reportId, versionId });
    return ok(undefined);
  }

  async listQueued(_limit: number): Promise<Result<readonly ScanRequest[], AppError>> {
    return ok(this.queuedList);
  }

  async markRunning(versionId: VersionId): Promise<Result<void, AppError>> {
    this.running.push(versionId);
    return ok(undefined);
  }

  async completeScan(
    versionId: VersionId,
    verdict: TerminalScanStatus,
  ): Promise<Result<void, AppError>> {
    this.completed.push({ versionId, verdict });
    return ok(undefined);
  }
}

/**
 * In-memory ScanWorkQueue fake. `fetch` claims (removes) published jobs so a
 * second drain doesn't re-deliver them; `complete`/`fail` just record. Models
 * pg-boss closely enough to unit-test the drain orchestration.
 */
export class InMemoryScanWorkQueue implements ScanWorkQueue {
  private seq = 0;
  readonly available: ScanJobMessage[] = [];
  readonly completedJobs: string[] = [];
  readonly failedJobs: Array<{ readonly jobId: string; readonly reason: string }> = [];

  async publish(reportId: ReportId, versionId: VersionId): Promise<Result<void, AppError>> {
    this.seq += 1;
    this.available.push({ reportId, versionId, jobId: `job-${this.seq}` });
    return ok(undefined);
  }

  async fetch(batchSize: number): Promise<Result<readonly ScanJobMessage[], AppError>> {
    return ok(this.available.splice(0, batchSize));
  }

  async complete(jobId: string): Promise<Result<void, AppError>> {
    this.completedJobs.push(jobId);
    return ok(undefined);
  }

  async fail(jobId: string, reason: string): Promise<Result<void, AppError>> {
    this.failedJobs.push({ jobId, reason });
    return ok(undefined);
  }
}

export class FakePlanLimiter implements PlanLimiter {
  constructor(private withinPlan = true) {}

  setWithinPlan(value: boolean): void {
    this.withinPlan = value;
  }

  async assertWithinPlan(_orgId: OrgId): Promise<Result<void, AppError>> {
    return this.withinPlan
      ? ok(undefined)
      : err({ kind: "PlanLimitExceeded", message: "plan limit exceeded" });
  }
}

export class SequentialIdGenerator implements IdGenerator {
  private r = 0;
  private v = 0;
  private f = 0;
  private c = 0;
  reportId(): ReportId {
    this.r += 1;
    return makeReportId(`r${this.r}`);
  }
  versionId(): VersionId {
    this.v += 1;
    return makeVersionId(`v${this.v}`);
  }
  folderId(): FolderId {
    this.f += 1;
    return makeFolderId(`f${this.f}`);
  }
  commentId(): CommentId {
    this.c += 1;
    return makeCommentId(`c${this.c}`);
  }
  private n = 0;
  nonceId(): string {
    this.n += 1;
    return `nonce-${this.n}`;
  }
}

export class SequentialSlugFactory implements SlugFactory {
  private n = 0;
  newSlug(): Slug {
    this.n += 1;
    const raw = `slug${this.n.toString().padStart(6, "0")}`; // 10 chars, nanoid alphabet
    const r = makeSlug(raw);
    if (!r.ok) throw new Error(`fake slug invalid: ${raw}`);
    return r.value;
  }
}

export class FixedClock implements Clock {
  constructor(private current = 0) {}
  set(ms: number): void {
    this.current = ms;
  }
  now(): number {
    return this.current;
  }
}

/** Pass-through UnitOfWork — the in-memory fakes share no real transaction.
 *  Fine for tests that don't assert rollback; a test that DOES assert "the
 *  mutation was rolled back" needs {@link TransactionalInMemoryUnitOfWork}. */
export class PassThroughUnitOfWork implements UnitOfWork {
  async run<T>(work: () => Promise<Result<T, AppError>>): Promise<Result<T, AppError>> {
    return work();
  }
}

/** A fake that can participate in {@link TransactionalInMemoryUnitOfWork}:
 *  snapshot its whole state before the work runs, restore it on rollback.
 *  Snapshots are shallow container copies — safe because domain values are
 *  immutable (`readonly` everywhere, ADR-024). */
export interface TxSnapshottable {
  snapshot(): unknown;
  restore(snapshot: unknown): void;
}

/**
 * An in-memory UnitOfWork that actually rolls back (unlike
 * {@link PassThroughUnitOfWork}): it snapshots every registered participant
 * before running `work`, and restores them when the work returns err (the
 * adapter's Rollback-sentinel path) or throws — mirroring DrizzleUnitOfWork's
 * semantics, including the `unitOfWork: …` Unexpected mapping for throws.
 * Register every fake the work mutates; an unregistered fake's writes survive
 * a rollback silently.
 */
export class TransactionalInMemoryUnitOfWork implements UnitOfWork {
  constructor(private readonly participants: readonly TxSnapshottable[]) {}

  async run<T>(work: () => Promise<Result<T, AppError>>): Promise<Result<T, AppError>> {
    const snapshots = this.participants.map((p) => p.snapshot());
    const rollback = () => {
      for (const [i, p] of this.participants.entries()) p.restore(snapshots[i]);
    };
    try {
      const r = await work();
      if (!r.ok) rollback();
      return r;
    } catch (e) {
      rollback();
      return err({
        kind: "Unexpected",
        message: `unitOfWork: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
}

/** Returns a canned ProcessedBundle (default: one clean index.html), or a
 *  configured AppError to exercise the 415/413/422 branches. */
export class FakeBundleProcessor implements BundleProcessor {
  private result: Result<ProcessedBundle, AppError>;

  constructor(result?: Result<ProcessedBundle, AppError>) {
    this.result =
      result ??
      ok({
        files: [
          {
            path: "index.html",
            contentType: "text/html",
            bytes: new TextEncoder().encode("<h1>ok</h1>"),
          },
        ],
        entryDocument: "index.html",
        contentHash: "hash-default",
        sizeBytes: 11,
      });
  }

  setResult(result: Result<ProcessedBundle, AppError>): void {
    this.result = result;
  }

  /** Convenience: succeed with a specific content hash (for idempotency tests). */
  setContentHash(contentHash: string): void {
    this.result = ok({
      files: [
        {
          path: "index.html",
          contentType: "text/html",
          bytes: new TextEncoder().encode("<h1>ok</h1>"),
        },
      ],
      entryDocument: "index.html",
      contentHash,
      sizeBytes: 11,
    });
  }

  async process(): Promise<Result<ProcessedBundle, AppError>> {
    return this.result;
  }
}

/** Deterministic non-crypto hash (FNV-1a, 8 hex) — fine for derived-key tests. */
export class FakeHasher implements Hasher {
  hash(input: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i += 1) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }
}

/** Mirrors Clerk identities in a Map, keyed by `clerkUserId|clerkOrgId`. */
export class InMemoryIdentityStore implements IdentityStore {
  private readonly byClerk = new Map<string, ProvisionedIdentity>();
  /** Clerk user ids that have been soft-deleted (ADR-0054) — terminal. */
  private readonly deleted = new Set<string>();
  // Internal-UserId ↔ email mirror (ADR-0060 §2's write-grant matching seam) —
  // populated on provisioning, or directly via seedUser() for fixtures that
  // don't go through the Clerk provisioning flow.
  private readonly emailByUserId = new Map<UserId, string>();
  private readonly userIdByEmail = new Map<string, UserId>(); // normalized email → userId
  // Internal-UserId → display name (ADR-0063 author display); null when unknown.
  private readonly displayNameByUserId = new Map<UserId, string | null>();
  private readonly orgByClerkOrgId = new Map<string, OrgId>();
  private readonly rootFolderByOrgId = new Map<OrgId, FolderId>();
  /** Test-only introspection: the `kind` each mirrored org was created with
   *  (ADR-0068 §3), keyed by our internal OrgId. */
  readonly kindByOrgId = new Map<OrgId, OrgKind>();
  /** The app-owned domain index (`orgs.domain`, ADR-0074) — at most one OrgId
   *  per domain, mirroring the partial unique index. Exposed for test
   *  introspection (the set-domain-if-null heal assertions). */
  readonly domainByOrgId = new Map<OrgId, string>();
  private seq = 0;

  private key(clerkUserId: string, clerkOrgId: string): string {
    return `${clerkUserId}|${clerkOrgId}`;
  }

  async findByClerk(
    clerkUserId: string,
    clerkOrgId: string,
  ): Promise<Result<ProvisionedIdentity | null, AppError>> {
    if (this.deleted.has(clerkUserId)) return ok(null); // soft-deleted → no actor
    return ok(this.byClerk.get(this.key(clerkUserId, clerkOrgId)) ?? null);
  }

  async findOrgByClerkOrgId(clerkOrgId: string): Promise<Result<OrgId | null, AppError>> {
    return ok(this.orgByClerkOrgId.get(clerkOrgId) ?? null);
  }

  async findTeamOrgByDomain(
    domain: string,
  ): Promise<Result<{ orgId: OrgId; clerkOrgId: string } | null, AppError>> {
    const normalized = domain.toLowerCase();
    for (const [clerkOrgId, orgIdValue] of this.orgByClerkOrgId) {
      if (this.domainByOrgId.get(orgIdValue) === normalized) {
        return ok({ orgId: orgIdValue, clerkOrgId });
      }
    }
    return ok(null);
  }

  async upsertTeamOrg(input: {
    readonly clerkOrgId: string;
    readonly name: string;
    readonly domain: string;
  }): Promise<Result<{ orgId: OrgId }, AppError>> {
    const domain = input.domain.toLowerCase();
    const owner = [...this.domainByOrgId.entries()].find(([, d]) => d === domain)?.[0] ?? null;

    const existing = this.orgByClerkOrgId.get(input.clerkOrgId);
    if (existing) {
      // set-domain-if-null heal — never re-key an already-domained row, and
      // never claim a domain another row owns (the partial unique index).
      if (!this.domainByOrgId.has(existing)) {
        if (owner !== null && owner !== existing) {
          return err(conflict(`domain "${domain}" already belongs to another org`));
        }
        this.domainByOrgId.set(existing, domain);
      }
      return ok({ orgId: existing });
    }

    if (owner !== null) {
      return err(conflict(`domain "${domain}" already belongs to another org`));
    }
    this.seq += 1;
    const orgIdValue = makeOrgId(`org-${this.seq}`);
    this.orgByClerkOrgId.set(input.clerkOrgId, orgIdValue);
    this.rootFolderByOrgId.set(orgIdValue, makeFolderId(`folder-${this.seq}`));
    this.kindByOrgId.set(orgIdValue, "team");
    this.domainByOrgId.set(orgIdValue, domain);
    return ok({ orgId: orgIdValue });
  }

  async createIdentity(input: {
    readonly clerkUserId: string;
    readonly clerkOrgId: string;
    readonly email: string;
    readonly displayName: string | null;
    readonly orgName: string;
    readonly kind: OrgKind;
    readonly domain?: string | null;
  }): Promise<Result<ProvisionedIdentity, AppError>> {
    // Deletion is terminal — never resurrect a soft-deleted user (ADR-0054).
    if (this.deleted.has(input.clerkUserId)) {
      return err(notAllowed("this account has been deleted"));
    }
    // Find-or-create like the real store; a re-provision refreshes the mirrored
    // email (review #150 M-2 — grant matching must follow a changed address).
    const existing = this.byClerk.get(this.key(input.clerkUserId, input.clerkOrgId));
    if (existing) {
      this.seedUser(existing.userId, input.email, input.displayName);
      this.recordDomainIfNull(existing.orgId, input.domain);
      return ok(existing);
    }

    // Org: find-or-create by clerkOrgId — a JIT team-org join (ADR-0068 §3)
    // reuses the SAME org + root folder a previous colleague's sign-up already
    // created; `kind` is recorded only on first creation, mirroring the real
    // Drizzle adapter's onConflictDoNothing semantics. A team `domain` is
    // recorded on creation and set-if-null on an existing row (ADR-0074 heal),
    // mirroring upsertTeamOrg.
    let orgIdValue = this.orgByClerkOrgId.get(input.clerkOrgId);
    let rootFolderIdValue: FolderId;
    if (orgIdValue) {
      rootFolderIdValue = this.rootFolderByOrgId.get(orgIdValue) as FolderId;
      this.recordDomainIfNull(orgIdValue, input.domain);
    } else {
      this.seq += 1;
      orgIdValue = makeOrgId(`org-${this.seq}`);
      rootFolderIdValue = makeFolderId(`folder-${this.seq}`);
      this.orgByClerkOrgId.set(input.clerkOrgId, orgIdValue);
      this.rootFolderByOrgId.set(orgIdValue, rootFolderIdValue);
      this.kindByOrgId.set(orgIdValue, input.kind);
      this.recordDomainIfNull(orgIdValue, input.domain);
    }

    this.seq += 1;
    const provisioned: ProvisionedIdentity = {
      userId: makeUserId(`user-${this.seq}`),
      orgId: orgIdValue,
      rootFolderId: rootFolderIdValue,
    };
    this.byClerk.set(this.key(input.clerkUserId, input.clerkOrgId), provisioned);
    this.seedUser(provisioned.userId, input.email, input.displayName);
    return ok(provisioned);
  }

  async softDeleteByClerkId(clerkUserId: string): Promise<Result<UserId | null, AppError>> {
    // Resolve the user by Clerk id REGARDLESS of prior delete state, so a retried
    // webhook still drives the (idempotent) cascade (self-healing, ADR-0054). The
    // stamp itself is idempotent; null only when no user row exists.
    const entry = [...this.byClerk.entries()].find(([k]) => k.startsWith(`${clerkUserId}|`));
    if (!entry) return ok(null); // unknown id — no-op
    this.deleted.add(clerkUserId); // idempotent — preserves the original deletion
    return ok(entry[1].userId);
  }

  async findEmailByUserId(userId: UserId): Promise<Result<string | null, AppError>> {
    // Soft-deleted users must not resolve (ADR-0054 terminal deletion,
    // ADR-0070 PII posture) — matches the real adapter's `deleted_at IS NULL`
    // filter (IdentityStore contract suite, ADR-0046).
    if (this.isDeletedUser(userId)) return ok(null);
    return ok(this.emailByUserId.get(userId) ?? null);
  }

  async findAuthorIdentityByUserId(
    userId: UserId,
  ): Promise<Result<AuthorIdentity | null, AppError>> {
    if (this.isDeletedUser(userId)) return ok(null); // no PII leak (ADR-0054/0070)
    const email = this.emailByUserId.get(userId);
    if (email === undefined) return ok(null); // unknown / never-seeded → miss
    return ok({ email, displayName: this.displayNameByUserId.get(userId) ?? null });
  }

  async findUserIdByEmail(email: string): Promise<Result<UserId | null, AppError>> {
    const resolved = this.userIdByEmail.get(email.trim().toLowerCase()) ?? null;
    if (resolved !== null && this.isDeletedUser(resolved)) return ok(null); // ADR-0054
    return ok(resolved);
  }

  /** Record a team org's domain into the index ONLY when the row has none yet
   *  and no other row owns it (mirrors the real adapter's COALESCE + partial
   *  unique index; ADR-0074 set-domain-if-null heal). */
  private recordDomainIfNull(orgIdValue: OrgId, domain: string | null | undefined): void {
    if (!domain || this.domainByOrgId.has(orgIdValue)) return;
    const normalized = domain.toLowerCase();
    for (const d of this.domainByOrgId.values()) if (d === normalized) return; // owned elsewhere
    this.domainByOrgId.set(orgIdValue, normalized);
  }

  /** Whether this internal UserId belongs to a soft-deleted Clerk user. */
  private isDeletedUser(userId: UserId): boolean {
    const clerkUserId = this.clerkIdFor(userId);
    return clerkUserId !== null && this.deleted.has(clerkUserId);
  }

  /** The clerkUserId behind an internal UserId (reverse of `byClerk`), or null. */
  private clerkIdFor(userId: UserId): string | null {
    for (const [key, id] of this.byClerk) {
      if (id.userId === userId) return key.split("|")[0] ?? null;
    }
    return null;
  }

  async listUsersMissingDisplayName(q: {
    readonly limit: number;
    readonly startingAfter?: UserId;
    readonly endingBefore?: UserId;
  }): Promise<
    Result<
      { items: readonly { userId: UserId; clerkUserId: string }[]; hasMore: boolean },
      AppError
    >
  > {
    // Dedup mirrored users by internal UserId, keep only those with no stored name
    // and not soft-deleted, keyset DESC on UserId (mirrors the Drizzle adapter).
    const seen = new Set<UserId>();
    const eligible: { userId: UserId; clerkUserId: string }[] = [];
    for (const [key, id] of this.byClerk) {
      if (seen.has(id.userId)) continue;
      seen.add(id.userId);
      const clerkUserId = key.split("|")[0] ?? "";
      const name = this.displayNameByUserId.get(id.userId) ?? null;
      if (name === null && !this.deleted.has(clerkUserId)) {
        eligible.push({ userId: id.userId, clerkUserId });
      }
    }
    eligible.sort((a, b) => (a.userId < b.userId ? 1 : a.userId > b.userId ? -1 : 0));
    // Range keyset (mirrors the adapter's `lt(users.id, cursor)`) so a cursor row
    // that was just written (and dropped from the target set) still pages cleanly.
    const after = q.startingAfter;
    const pool = after ? eligible.filter((r) => r.userId < after) : eligible;
    return ok({ items: pool.slice(0, q.limit), hasMore: pool.length > q.limit });
  }

  async setDisplayNameIfNull(
    userId: UserId,
    displayName: string,
  ): Promise<Result<boolean, AppError>> {
    const clerkUserId = this.clerkIdFor(userId);
    if (clerkUserId === null || this.deleted.has(clerkUserId)) return ok(false);
    const current = this.displayNameByUserId.get(userId) ?? null;
    if (current !== null) return ok(false); // already set → no-op (idempotent)
    this.displayNameByUserId.set(userId, displayName);
    return ok(true);
  }

  /** Test-only seam: register a user's email (and optional display name) directly,
   *  for fixtures (e.g. write-grant tests) that need a resolvable user without a
   *  full Clerk provisioning round-trip. A null/omitted `displayName` PRESERVES any
   *  previously-seeded name (mirrors the real store's COALESCE on re-provision). */
  seedUser(userId: UserId, email: string, displayName: string | null = null): void {
    const prev = this.emailByUserId.get(userId);
    if (prev) this.userIdByEmail.delete(prev.trim().toLowerCase());
    this.emailByUserId.set(userId, email);
    this.userIdByEmail.set(email.trim().toLowerCase(), userId);
    if (displayName !== null) this.displayNameByUserId.set(userId, displayName);
  }
}

/** In-memory per-report write grants (ADR-0060) — mirrors DrizzleWriteGrantStore's
 *  upsert/delete-by-key + dual userId-or-email match semantics. */
export class InMemoryWriteGrantStore implements WriteGrantStore {
  private readonly grants = new Map<string, WriteGrant>(); // `${reportId}|${normalizedEmail}`

  private key(reportId: ReportId, email: string): string {
    return `${reportId}|${email.trim().toLowerCase()}`;
  }

  async grant(
    reportId: ReportId,
    email: string,
    grantedBy: UserId,
    granteeUserId: UserId | null,
  ): Promise<Result<void, AppError>> {
    const normalized = email.trim().toLowerCase();
    this.grants.set(this.key(reportId, email), {
      reportId,
      granteeEmail: normalized,
      granteeUserId,
      grantedBy,
      grantedAt: Date.now(),
    });
    return ok(undefined);
  }

  async revoke(reportId: ReportId, email: string): Promise<Result<void, AppError>> {
    this.grants.delete(this.key(reportId, email));
    return ok(undefined);
  }

  async listByReport(reportId: ReportId): Promise<Result<readonly WriteGrant[], AppError>> {
    return ok(
      [...this.grants.entries()].filter(([k]) => k.startsWith(`${reportId}|`)).map(([, v]) => v),
    );
  }

  async findFor(
    reportId: ReportId,
    actor: { readonly userId: UserId; readonly email?: string },
  ): Promise<Result<WriteGrant | null, AppError>> {
    const byEmail = actor.email ? this.grants.get(this.key(reportId, actor.email)) : undefined;
    if (byEmail) return ok(byEmail);
    for (const [k, g] of this.grants) {
      if (k.startsWith(`${reportId}|`) && g.granteeUserId === actor.userId) return ok(g);
    }
    return ok(null);
  }
}

/** In-memory OrgWriteGrantStore (ADR-0078) — one row per report, keyed by
 *  report id alone. No email and no `findFor(actor)`: the org match is the
 *  APPLICATION layer's job (`hasOrgWriteGrant`), so a store fake cannot
 *  accidentally make the real check pass. */
export class InMemoryOrgWriteGrantStore implements OrgWriteGrantStore {
  private readonly grants = new Map<string, OrgWriteGrant>(); // reportId -> grant

  async grant(
    reportId: ReportId,
    orgId: OrgId,
    grantedBy: UserId,
  ): Promise<Result<void, AppError>> {
    this.grants.set(reportId, { reportId, orgId, grantedBy, grantedAt: Date.now() });
    return ok(undefined);
  }

  async revoke(reportId: ReportId): Promise<Result<void, AppError>> {
    this.grants.delete(reportId);
    return ok(undefined);
  }

  async find(reportId: ReportId): Promise<Result<OrgWriteGrant | null, AppError>> {
    return ok(this.grants.get(reportId) ?? null);
  }
}

/** In-memory FolderShareStore (ADR-0076) — mirrors InMemoryWriteGrantStore:
 *  email-keyed upsert, revoke-by-delete, userId-or-normalized-email findFor. */
export class InMemoryFolderShareStore implements FolderShareStore {
  private readonly shares = new Map<string, FolderShare>(); // `${folderId}|${normalizedEmail}`

  private key(folderId: FolderId, email: string): string {
    return `${folderId}|${normalizeEmailAddress(email)}`;
  }

  async grant(
    folderId: FolderId,
    email: string,
    grantedBy: UserId,
    granteeUserId: UserId | null,
  ): Promise<Result<void, AppError>> {
    const normalized = normalizeEmailAddress(email);
    this.shares.set(this.key(folderId, email), {
      folderId,
      granteeEmail: normalized,
      granteeUserId,
      grantedBy,
      grantedAt: Date.now(),
    });
    return ok(undefined);
  }

  async revoke(folderId: FolderId, email: string): Promise<Result<void, AppError>> {
    this.shares.delete(this.key(folderId, email));
    return ok(undefined);
  }

  async listByFolder(folderId: FolderId): Promise<Result<readonly FolderShare[], AppError>> {
    return ok(
      [...this.shares.entries()].filter(([k]) => k.startsWith(`${folderId}|`)).map(([, v]) => v),
    );
  }

  async findFor(
    folderId: FolderId,
    actor: { readonly userId: UserId; readonly email?: string },
  ): Promise<Result<FolderShare | null, AppError>> {
    const byEmail = actor.email ? this.shares.get(this.key(folderId, actor.email)) : undefined;
    if (byEmail) return ok(byEmail);
    for (const [k, s] of this.shares) {
      if (k.startsWith(`${folderId}|`) && s.granteeUserId === actor.userId) return ok(s);
    }
    return ok(null);
  }
}

/** In-memory ApiKeyStore — stores keys as plain records (no real crypto); enough
 *  to exercise the revoke / cascade paths in use-case tests. */
export class InMemoryApiKeyStore implements ApiKeyStore {
  private seq = 0;
  /** Test toggle: when true, revokeAllForUser fails (simulate a partial-cascade failure). */
  failRevokeAllForUser = false;
  readonly keys: {
    id: string;
    actingUserId: UserId;
    issuedInOrgId: OrgId;
    name: string;
    scopes: readonly string[];
    keyPrefix: string;
    token: string;
    createdAt: number;
    lastUsedAt: number | null;
    revokedAt: number | null;
  }[] = [];

  private summary(k: (typeof this.keys)[number]): ApiKeySummary {
    return {
      id: k.id,
      name: k.name,
      scopes: k.scopes,
      keyPrefix: k.keyPrefix,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
      revokedAt: k.revokedAt,
    };
  }

  async verify(token: string): Promise<Result<ApiKeyPrincipal | null, AppError>> {
    const k = this.keys.find((x) => x.token === token && x.revokedAt === null);
    if (!k) return ok(null);
    k.lastUsedAt = 0;
    return ok({
      userId: k.actingUserId,
      orgId: k.issuedInOrgId,
      rootFolderId: makeFolderId("folder-root"),
      scopes: k.scopes,
    });
  }

  async create(input: {
    readonly actingUserId: UserId;
    readonly issuedInOrgId: OrgId;
    readonly name: string;
    readonly scopes: readonly string[];
  }): Promise<Result<{ readonly token: string; readonly summary: ApiKeySummary }, AppError>> {
    this.seq += 1;
    const id = `key-${this.seq}`;
    const token = `arp_test_${this.seq}`;
    const record = {
      id,
      actingUserId: input.actingUserId,
      issuedInOrgId: input.issuedInOrgId,
      name: input.name,
      scopes: input.scopes,
      keyPrefix: `arp_${id}`,
      token,
      createdAt: this.seq,
      lastUsedAt: null,
      revokedAt: null,
    };
    this.keys.push(record);
    return ok({ token, summary: this.summary(record) });
  }

  async listForUser(actingUserId: UserId): Promise<Result<readonly ApiKeySummary[], AppError>> {
    return ok(
      this.keys
        .filter((k) => k.actingUserId === actingUserId)
        .reverse()
        .map((k) => this.summary(k)),
    );
  }

  async revoke(id: string, actingUserId: UserId): Promise<Result<void, AppError>> {
    const k = this.keys.find(
      (x) => x.id === id && x.actingUserId === actingUserId && x.revokedAt === null,
    );
    if (k) k.revokedAt = this.seq;
    return ok(undefined);
  }

  async revokeAllForUser(actingUserId: UserId): Promise<Result<number, AppError>> {
    if (this.failRevokeAllForUser) {
      return err({ kind: "Unexpected", message: "simulated revoke failure" });
    }
    let n = 0;
    for (const k of this.keys) {
      if (k.actingUserId === actingUserId && k.revokedAt === null) {
        k.revokedAt = this.seq;
        n += 1;
      }
    }
    return ok(n);
  }
}

/** Fake Clerk org provisioner (ADR-0074 surface) — models Clerk-side orgs as
 *  `{ name, anchor }` records keyed by Clerk org id. Crucially an org CAN
 *  exist WITHOUT a `publicMetadata.domain` anchor (`anchor: null`) — the
 *  representability gap the old domain-Map keying couldn't express, which is
 *  exactly what hid the dead slug lookup in production. */
export class FakeClerkOrgProvisioner implements ClerkOrgProvisioner {
  readonly calls: { readonly clerkUserId: string; readonly name: string }[] = [];
  /** When set, findPersonalOrg resolves to this org id; null means "no org yet". */
  personalOrgId: string | null = null;

  /** The Clerk instance's orgs: id → { name, anchor }. Seed via addClerkOrg()
   *  to simulate pre-existing orgs (with or without an anchor);
   *  `createTeamOrg` registers here too. */
  readonly clerkOrgRecords = new Map<string, { name: string; anchor: string | null }>();
  readonly teamOrgCalls: { readonly domain: string; readonly createdBy: string }[] = [];
  readonly membershipCalls: { readonly clerkOrgId: string; readonly clerkUserId: string }[] = [];
  /** Test toggle: ensureMembership fails with the typed member-cap error
   *  (ADR-0074 — the webhook acks it instead of retrying). */
  memberCapReached = false;

  /** Seed a Clerk-side org (optionally anchorless — the pre-anchor legacy shape). */
  addClerkOrg(id: string, org: { name?: string; anchor?: string | null } = {}): void {
    this.clerkOrgRecords.set(id, { name: org.name ?? id, anchor: org.anchor ?? null });
  }

  async createPersonalOrg(clerkUserId: string, name: string): Promise<Result<string, AppError>> {
    this.calls.push({ clerkUserId, name });
    return ok(`clerk-org-${clerkUserId}`);
  }

  async findPersonalOrg(_clerkUserId: string): Promise<Result<string | null, AppError>> {
    return ok(this.personalOrgId);
  }

  async verifyOrgAnchor(clerkOrgId: string, domain: string): Promise<Result<void, AppError>> {
    // Fail-closed like the real adapter: missing org, null anchor, and
    // mismatched anchor are all refusals (ADR-0074 tenant-boundary guard).
    const org = this.clerkOrgRecords.get(clerkOrgId);
    if (!org || org.anchor !== domain.toLowerCase()) {
      return err({
        kind: "Unexpected",
        message: `team-org anchor mismatch for domain "${domain}" on ${clerkOrgId} — refusing to join`,
      });
    }
    return ok(undefined);
  }

  async findOrgByAnchorScan(
    domain: string,
  ): Promise<Result<{ clerkOrgId: string; name: string } | null, AppError>> {
    // Exact anchor match only — an anchorless org is never adoptable.
    for (const [id, org] of this.clerkOrgRecords) {
      if (org.anchor === domain.toLowerCase()) return ok({ clerkOrgId: id, name: org.name });
    }
    return ok(null);
  }

  async createTeamOrg(domain: string, createdBy: string): Promise<Result<string, AppError>> {
    this.teamOrgCalls.push({ domain, createdBy });
    const normalized = domain.toLowerCase();
    const id = `clerk-team-org-${normalized}`;
    this.clerkOrgRecords.set(id, { name: normalized, anchor: normalized });
    return ok(id);
  }

  async ensureMembership(clerkOrgId: string, clerkUserId: string): Promise<Result<void, AppError>> {
    if (this.memberCapReached) {
      return err({
        kind: "PlanLimitExceeded",
        message: `clerk org ${clerkOrgId} is at its membership cap`,
      });
    }
    this.membershipCalls.push({ clerkOrgId, clerkUserId });
    return ok(undefined);
  }
}

/** Deterministic password hasher for use-case tests (NOT argon2 — `hashed:<plaintext>`). */
export class FakePasswordHasher implements PasswordHasher {
  async hash(plaintext: string): Promise<Result<string, AppError>> {
    return ok(`hashed:${plaintext}`);
  }
  async verify(plaintext: string, hash: string): Promise<Result<boolean, AppError>> {
    return ok(hash === `hashed:${plaintext}`);
  }
}

/** Capturing EmailSender for use-case tests (ADR-0057) — records sent messages, never sends. */
export class FakeEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<Result<void, AppError>> {
    this.sent.push(message);
    return ok(undefined);
  }
}

/** In-memory single-use NonceStore for use-case tests (ADR-0056) — `take` deletes. */
export class FakeNonceStore implements NonceStore {
  private readonly store = new Map<string, string>();
  async put(id: string, value: string, _ttlSeconds: number): Promise<Result<void, AppError>> {
    this.store.set(id, value);
    return ok(undefined);
  }
  async take(id: string): Promise<Result<string | null, AppError>> {
    const v = this.store.get(id) ?? null;
    this.store.delete(id);
    return ok(v);
  }
}

/** In-memory revocable GrantStore for use-case tests (ADR-0056, revocation-C). */
export class InMemoryGrantStore implements GrantStore {
  // Failure toggles for error-path tests (same convention as failRevokeAllForUser above).
  failRevoke = false;
  failRevokeAll = false;
  private readonly grants = new Map<string, number>(); // `${reportId}|${email}` → expiresAtMs
  // Time via the Clock port (not Date.now()) so use-case tests with a FixedClock stay
  // deterministic; email normalized like the real store + the allowlist (claude-review #114).
  constructor(private readonly clock: Clock) {}
  private key(reportId: ReportId, email: string) {
    return `${reportId}|${email.trim().toLowerCase()}`;
  }
  async grant(
    reportId: ReportId,
    email: string,
    expiresAtMs: number,
  ): Promise<Result<void, AppError>> {
    this.grants.set(this.key(reportId, email), expiresAtMs);
    return ok(undefined);
  }
  async isGranted(reportId: ReportId, email: string): Promise<Result<boolean, AppError>> {
    const exp = this.grants.get(this.key(reportId, email));
    return ok(exp !== undefined && exp > this.clock.now());
  }
  async revoke(reportId: ReportId, email: string): Promise<Result<void, AppError>> {
    if (this.failRevoke) return err({ kind: "Unexpected", message: "simulated revoke failure" });
    this.grants.delete(this.key(reportId, email));
    return ok(undefined);
  }
  async revokeAll(reportId: ReportId): Promise<Result<void, AppError>> {
    if (this.failRevokeAll) {
      return err({ kind: "Unexpected", message: "simulated revokeAll failure" });
    }
    for (const k of [...this.grants.keys()])
      if (k.startsWith(`${reportId}|`)) this.grants.delete(k);
    return ok(undefined);
  }
}

/** Fresh ADR-0039 idempotency deps (`IdempotentWriteDeps`) for use-case tests —
 *  every mutating use case now requires them (idempotent-write.ts). */
export function idempotencyTestDeps(): {
  idempotency: InMemoryIdempotencyStore;
  keyHasher: FakeHasher;
} {
  return { idempotency: new InMemoryIdempotencyStore(), keyHasher: new FakeHasher() };
}
