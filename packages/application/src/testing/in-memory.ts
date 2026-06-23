// In-memory fakes for the driven ports — fast, deterministic substrate for
// use-case unit tests (1d+). NOT for production and NOT a substitute for the
// real-infra e2e (ADR-0019); they just let the functional use cases be TDD'd
// without Neon/R2.

import {
  type AppError,
  type DomainEvent,
  err,
  type Folder,
  type FolderId,
  folderId as makeFolderId,
  orgId as makeOrgId,
  reportId as makeReportId,
  makeSlug,
  userId as makeUserId,
  versionId as makeVersionId,
  notAllowed,
  type OrgId,
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
import type {
  ApiKeyPrincipal,
  ApiKeyStore,
  ApiKeySummary,
  BlobFile,
  BlobStore,
  BundleProcessor,
  ClerkOrgProvisioner,
  Clock,
  EventOutbox,
  FolderListQuery,
  FolderPage,
  FolderRepository,
  Hasher,
  IdempotencyBegin,
  IdempotencyKeyRef,
  IdempotencyRecord,
  IdempotencyStore,
  IdentityStore,
  IdGenerator,
  PlanLimiter,
  ProcessedBundle,
  ProvisionedIdentity,
  ReportPage,
  ReportRepository,
  ReportSearchQuery,
  ReportSummary,
  ScanJobMessage,
  ScanQueue,
  ScanRequest,
  ScanWorkQueue,
  SlugFactory,
  UnitOfWork,
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

export class InMemoryFolderRepository implements FolderRepository {
  private readonly byId = new Map<string, Folder>();

  async listByOrg(orgId: OrgId): Promise<Result<readonly Folder[], AppError>> {
    return ok([...this.byId.values()].filter((f) => f.orgId === orgId && f.deletedAt === null));
  }

  async searchByOrg(orgId: OrgId, q: FolderListQuery): Promise<Result<FolderPage, AppError>> {
    const matched = [...this.byId.values()].filter(
      (f) => f.orgId === orgId && f.deletedAt === null,
    );
    return ok(keysetPage(matched, q));
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
}

export class InMemoryReportRepository implements ReportRepository {
  private readonly byId = new Map<string, Report>();
  private readonly slugToId = new Map<string, string>();

  async findBySlug(slug: Slug): Promise<Result<Report | null, AppError>> {
    const id = this.slugToId.get(slug);
    return ok(id ? (this.byId.get(id) ?? null) : null);
  }

  async findById(id: ReportId): Promise<Result<Report | null, AppError>> {
    return ok(this.byId.get(id) ?? null);
  }

  async listByOrg(orgId: OrgId): Promise<Result<readonly ReportSummary[], AppError>> {
    const summaries = [...this.byId.values()]
      .filter((r) => r.orgId === orgId && r.deletedAt === null)
      // Approximates the adapter's `ORDER BY updated_at DESC` via Map insertion
      // order (reversed). NOTE: this does NOT model re-save reordering — the real
      // adapter bumps updated_at on a re-upload, moving a report to the front; the
      // fake keeps original insertion position. Tests must not rely on re-save order.
      .reverse()
      .map((r) => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        isPublished: r.liveVersionId !== null,
        folderId: r.folderId,
      }));
    return ok(summaries);
  }

  async searchByOrg(orgId: OrgId, q: ReportSearchQuery): Promise<Result<ReportPage, AppError>> {
    const needle = q.query?.trim().toLowerCase();
    const matched = [...this.byId.values()]
      .filter((r) => r.orgId === orgId && r.deletedAt === null)
      .filter((r) => (q.folderId ? r.folderId === q.folderId : true))
      .filter((r) =>
        needle
          ? r.title.toLowerCase().includes(needle) || r.slug.toLowerCase().includes(needle)
          : true,
      );
    const { items, hasMore } = keysetPage(matched, q); // keyset on id DESC (ADR-0053)
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

  async save(report: Report): Promise<Result<void, AppError>> {
    this.byId.set(report.id, report);
    this.slugToId.set(report.slug, report.id);
    return ok(undefined);
  }

  async softDelete(id: ReportId): Promise<Result<void, AppError>> {
    const r = this.byId.get(id);
    if (r) this.byId.set(id, { ...r, deletedAt: 1 });
    return ok(undefined);
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

export class InMemoryIdempotencyStore implements IdempotencyStore {
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
}

export class InMemoryEventOutbox implements EventOutbox {
  private readonly events: DomainEvent[] = [];

  async enqueue(events: readonly DomainEvent[]): Promise<Result<void, AppError>> {
    this.events.push(...events);
    return ok(undefined);
  }

  /** Test helper: the events enqueued so far (in order). */
  drained(): readonly DomainEvent[] {
    return [...this.events];
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

/** Pass-through UnitOfWork — the in-memory fakes share no real transaction. */
export class PassThroughUnitOfWork implements UnitOfWork {
  async run<T>(work: () => Promise<Result<T, AppError>>): Promise<Result<T, AppError>> {
    return work();
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

  async createPersonalIdentity(input: {
    readonly clerkUserId: string;
    readonly clerkOrgId: string;
    readonly email: string;
    readonly orgName: string;
  }): Promise<Result<ProvisionedIdentity, AppError>> {
    // Deletion is terminal — never resurrect a soft-deleted user (ADR-0054).
    if (this.deleted.has(input.clerkUserId)) {
      return err(notAllowed("this account has been deleted"));
    }
    this.seq += 1;
    const provisioned: ProvisionedIdentity = {
      userId: makeUserId(`user-${this.seq}`),
      orgId: makeOrgId(`org-${this.seq}`),
      rootFolderId: makeFolderId(`folder-${this.seq}`),
    };
    this.byClerk.set(this.key(input.clerkUserId, input.clerkOrgId), provisioned);
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

/** Fake Clerk org creator — returns a deterministic id and records its calls. */
export class FakeClerkOrgProvisioner implements ClerkOrgProvisioner {
  readonly calls: { readonly clerkUserId: string; readonly name: string }[] = [];
  /** When set, findPersonalOrg resolves to this org id; null means "no org yet". */
  personalOrgId: string | null = null;

  async createPersonalOrg(clerkUserId: string, name: string): Promise<Result<string, AppError>> {
    this.calls.push({ clerkUserId, name });
    return ok(`clerk-org-${clerkUserId}`);
  }

  async findPersonalOrg(_clerkUserId: string): Promise<Result<string | null, AppError>> {
    return ok(this.personalOrgId);
  }
}
