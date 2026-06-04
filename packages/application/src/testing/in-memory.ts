// In-memory fakes for the driven ports — fast, deterministic substrate for
// use-case unit tests (1d+). NOT for production and NOT a substitute for the
// real-infra e2e (ADR-0019); they just let the functional use cases be TDD'd
// without Neon/R2.

import {
  type AppError,
  type DomainEvent,
  err,
  reportId as makeReportId,
  makeSlug,
  versionId as makeVersionId,
  type OrgId,
  ok,
  type Report,
  type ReportId,
  type Result,
  type Slug,
  type VersionId,
} from "arp-domain";
import type {
  BlobFile,
  BlobStore,
  BundleProcessor,
  Clock,
  EventOutbox,
  Hasher,
  IdempotencyBegin,
  IdempotencyKeyRef,
  IdempotencyRecord,
  IdempotencyStore,
  IdGenerator,
  PlanLimiter,
  ProcessedBundle,
  ReportRepository,
  ScanQueue,
  SlugFactory,
  UnitOfWork,
} from "../ports";

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

  async save(report: Report): Promise<Result<void, AppError>> {
    this.byId.set(report.id, report);
    this.slugToId.set(report.slug, report.id);
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

  async enqueueScan(reportId: ReportId, versionId: VersionId): Promise<Result<void, AppError>> {
    this.enqueued.push({ reportId, versionId });
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
  reportId(): ReportId {
    this.r += 1;
    return makeReportId(`r${this.r}`);
  }
  versionId(): VersionId {
    this.v += 1;
    return makeVersionId(`v${this.v}`);
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
