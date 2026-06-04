// In-memory fakes for the driven ports — fast, deterministic substrate for
// use-case unit tests (1d+). NOT for production and NOT a substitute for the
// real-infra e2e (ADR-0019); they just let the functional use cases be TDD'd
// without Neon/R2.

import {
  type AppError,
  type DomainEvent,
  type OrgId,
  type Report,
  type ReportId,
  type Result,
  type Slug,
  type VersionId,
  err,
  makeSlug,
  ok,
  reportId as makeReportId,
  versionId as makeVersionId,
} from 'arp-domain';
import type {
  BlobFile,
  BlobStore,
  Clock,
  EventOutbox,
  IdGenerator,
  IdempotencyBegin,
  IdempotencyKeyRef,
  IdempotencyRecord,
  IdempotencyStore,
  PlanLimiter,
  ReportRepository,
  ScanQueue,
  SlugFactory,
  UnitOfWork,
} from '../ports';

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

  async readObject(reportId: ReportId, versionId: VersionId, path: string): Promise<Result<BlobFile | null, AppError>> {
    return ok(this.objects.get(blobKey(reportId, versionId, path)) ?? null);
  }

  async deleteVersionPrefix(reportId: ReportId, versionId: VersionId): Promise<Result<void, AppError>> {
    const prefix = `${reportId}/${versionId}/`;
    for (const k of [...this.objects.keys()]) if (k.startsWith(prefix)) this.objects.delete(k);
    return ok(undefined);
  }
}

const idemKey = (ref: IdempotencyKeyRef) => `${ref.actingUserId}|${ref.route}|${ref.key}`;

interface IdemEntry {
  readonly fingerprint: string;
  state: 'in_flight' | 'completed';
  record?: IdempotencyRecord;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly entries = new Map<string, IdemEntry>();

  async begin(ref: IdempotencyKeyRef, fingerprint: string): Promise<Result<IdempotencyBegin, AppError>> {
    const k = idemKey(ref);
    const existing = this.entries.get(k);
    if (!existing) {
      this.entries.set(k, { fingerprint, state: 'in_flight' });
      return ok({ outcome: 'proceed' });
    }
    if (existing.fingerprint !== fingerprint) {
      return err({
        kind: 'IdempotencyKeyReuseDifferentBody',
        message: 'idempotency key reused with a different request',
      });
    }
    if (existing.state === 'completed' && existing.record) {
      return ok({ outcome: 'replay', record: existing.record });
    }
    return ok({ outcome: 'in_flight' });
  }

  async complete(ref: IdempotencyKeyRef, record: IdempotencyRecord): Promise<Result<void, AppError>> {
    const k = idemKey(ref);
    const existing = this.entries.get(k);
    if (existing) {
      existing.state = 'completed';
      existing.record = record;
    } else {
      this.entries.set(k, { fingerprint: '', state: 'completed', record });
    }
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
    return this.withinPlan ? ok(undefined) : err({ kind: 'PlanLimitExceeded', message: 'plan limit exceeded' });
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
    const raw = `slug${this.n.toString().padStart(6, '0')}`; // 10 chars, nanoid alphabet
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
