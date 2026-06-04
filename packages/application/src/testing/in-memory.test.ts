import { createReport, folderId, makeSlug, orgId, reportId, userId, versionId } from 'arp-domain';
import { describe, expect, it } from 'vitest';
import type { IdempotencyKeyRef } from '../ports';
import {
  FakePlanLimiter,
  FixedClock,
  InMemoryBlobStore,
  InMemoryEventOutbox,
  InMemoryIdempotencyStore,
  InMemoryReportRepository,
  RecordingScanQueue,
  SequentialIdGenerator,
  SequentialSlugFactory,
} from './in-memory';

const slug = (s: string) => {
  const r = makeSlug(s);
  if (!r.ok) throw new Error('bad slug');
  return r.value;
};

const sampleReport = () =>
  createReport({
    id: reportId('r1'),
    orgId: orgId('o1'),
    folderId: folderId('f1'),
    slug: slug('abc1234567'),
    title: 'Q3',
    versionId: versionId('v1'),
    contentHash: 'h1',
    uploadedBy: userId('u1'),
  }).report;

describe('InMemoryReportRepository', () => {
  it('round-trips by id and slug; unknown slug → null', async () => {
    const repo = new InMemoryReportRepository();
    const report = sampleReport();
    await repo.save(report);

    const byId = await repo.findById(reportId('r1'));
    const bySlug = await repo.findBySlug(slug('abc1234567'));
    const missing = await repo.findBySlug(slug('zzzzzzzzzz'));

    expect(byId.ok && byId.value?.id).toBe('r1');
    expect(bySlug.ok && bySlug.value?.slug).toBe('abc1234567');
    expect(missing.ok && missing.value).toBeNull();
  });
});

describe('InMemoryBlobStore', () => {
  it('puts, reads, and deletes a version prefix', async () => {
    const store = new InMemoryBlobStore();
    const files = [{ path: 'index.html', contentType: 'text/html', bytes: new TextEncoder().encode('<h1>hi') }];
    await store.putVersionBundle(reportId('r1'), versionId('v1'), files);

    const got = await store.readObject(reportId('r1'), versionId('v1'), 'index.html');
    expect(got.ok && got.value?.contentType).toBe('text/html');

    const miss = await store.readObject(reportId('r1'), versionId('v1'), 'nope.html');
    expect(miss.ok && miss.value).toBeNull();

    await store.deleteVersionPrefix(reportId('r1'), versionId('v1'));
    const gone = await store.readObject(reportId('r1'), versionId('v1'), 'index.html');
    expect(gone.ok && gone.value).toBeNull();
  });
});

describe('InMemoryIdempotencyStore', () => {
  const ref: IdempotencyKeyRef = { actingUserId: userId('u1'), route: 'POST /api/v1/reports', key: 'k1' };

  it('proceeds, then replays after completion; reuse with a different body → 422 kind', async () => {
    const store = new InMemoryIdempotencyStore();

    const first = await store.begin(ref, 'fp-A');
    expect(first.ok && first.value.outcome).toBe('proceed');

    const concurrent = await store.begin(ref, 'fp-A');
    expect(concurrent.ok && concurrent.value.outcome).toBe('in_flight');

    await store.complete(ref, { responseStatus: 201, responseBody: { slug: 'abc1234567' } });

    const replay = await store.begin(ref, 'fp-A');
    expect(replay.ok && replay.value.outcome).toBe('replay');
    if (replay.ok && replay.value.outcome === 'replay') {
      expect(replay.value.record.responseStatus).toBe(201);
    }

    const reused = await store.begin(ref, 'fp-DIFFERENT');
    expect(reused.ok).toBe(false);
    if (!reused.ok) expect(reused.error.kind).toBe('IdempotencyKeyReuseDifferentBody');
  });
});

describe('InMemoryEventOutbox', () => {
  it('preserves enqueued events in order', async () => {
    const outbox = new InMemoryEventOutbox();
    await outbox.enqueue([{ type: 'ReportVersionUploaded', reportId: reportId('r1'), versionId: versionId('v1'), versionNo: 1 }]);
    await outbox.enqueue([{ type: 'ReportPublished', reportId: reportId('r1'), versionId: versionId('v1'), firstPublish: true }]);
    expect(outbox.drained().map((e) => e.type)).toEqual(['ReportVersionUploaded', 'ReportPublished']);
  });
});

describe('RecordingScanQueue + FakePlanLimiter', () => {
  it('records scans and toggles plan-limit verdicts', async () => {
    const scans = new RecordingScanQueue();
    await scans.enqueueScan(reportId('r1'), versionId('v1'));
    expect(scans.enqueued).toEqual([{ reportId: 'r1', versionId: 'v1' }]);

    const limiter = new FakePlanLimiter();
    expect((await limiter.assertWithinPlan(orgId('o1'))).ok).toBe(true);
    limiter.setWithinPlan(false);
    const denied = await limiter.assertWithinPlan(orgId('o1'));
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.kind).toBe('PlanLimitExceeded');
  });
});

describe('deterministic services', () => {
  it('ids, slugs, and clock are deterministic', () => {
    const ids = new SequentialIdGenerator();
    expect([ids.reportId(), ids.reportId(), ids.versionId()]).toEqual(['r1', 'r2', 'v1']);

    const slugs = new SequentialSlugFactory();
    const a = slugs.newSlug();
    const b = slugs.newSlug();
    expect(a).toHaveLength(10);
    expect(a).not.toBe(b);

    const clock = new FixedClock(0);
    clock.set(1717000000000);
    expect(clock.now()).toBe(1717000000000);
  });
});
