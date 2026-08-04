// A default-wired test harness for use-case tests (mission: shared use-case
// test harness). upload-report.test.ts used to hand-roll all 11 of
// UploadReportDeps' fakes per test; makeAppTestHarness() wires the same
// defaults behind one call, exposing named handles for assertions and
// allowing a single seam to be overridden per test (e.g. a pre-configured
// FakeBundleProcessor) while the rest stay default. Convert other use-case
// test files opportunistically — upload-report.test.ts is the exemplar.
import type { UploadReportDeps } from "../use-cases/upload-report";
import {
  FakeBundleProcessor,
  FakeHasher,
  FakePlanLimiter,
  InMemoryAuditLogger,
  InMemoryBlobStore,
  InMemoryEventOutbox,
  InMemoryFolderRepository,
  InMemoryIdempotencyStore,
  InMemoryIdentityStore,
  InMemoryOrgWriteGrantStore,
  InMemoryReportRepository,
  InMemoryWriteGrantStore,
  PassThroughUnitOfWork,
  RecordingScanQueue,
  SequentialIdGenerator,
  SequentialSlugFactory,
} from "./in-memory";

export interface AppTestHarness {
  readonly deps: UploadReportDeps;
  readonly reports: InMemoryReportRepository;
  readonly blobs: InMemoryBlobStore;
  readonly bundles: FakeBundleProcessor;
  readonly idempotency: InMemoryIdempotencyStore;
  readonly outbox: InMemoryEventOutbox;
  /** Audit log (ADR-0070) — every mutating action's audit_log row. */
  readonly audit: InMemoryAuditLogger;
  readonly scans: RecordingScanQueue;
  readonly planLimiter: FakePlanLimiter;
  /** Write grants (ADR-0060) — the canWrite seam's reUpload call site. */
  readonly grants: InMemoryWriteGrantStore;
  readonly identities: InMemoryIdentityStore;
  /** The folder tree (ADR-0078 §6) — uploadReport reads the DESTINATION
   *  folder's visibility to decide the new report's initial Acl. */
  readonly folders: InMemoryFolderRepository;
}

/** The subset of {@link AppTestHarness} a caller may override — one seam at a
 *  time, e.g. `{ bundles: preconfiguredBundles }`, leaving everything else default. */
export type AppTestHarnessOverrides = Partial<
  Pick<
    AppTestHarness,
    | "reports"
    | "blobs"
    | "bundles"
    | "idempotency"
    | "outbox"
    | "audit"
    | "scans"
    | "planLimiter"
    | "grants"
    | "identities"
    | "folders"
  >
>;

/**
 * Default-wired in-memory fakes for the upload pipeline's deps (ADR-0037),
 * one call instead of hand-rolling 11 fakes per test. `ids`/`slugs`/`hasher`/
 * `uow` are always fresh deterministic fakes (SequentialIdGenerator,
 * SequentialSlugFactory, FakeHasher, PassThroughUnitOfWork) — they have no
 * assertable state a test would want to override or inspect independently of
 * `deps`, unlike the named handles below.
 */
export function makeAppTestHarness(overrides: AppTestHarnessOverrides = {}): AppTestHarness {
  const reports = overrides.reports ?? new InMemoryReportRepository();
  const blobs = overrides.blobs ?? new InMemoryBlobStore();
  const bundles = overrides.bundles ?? new FakeBundleProcessor();
  const idempotency = overrides.idempotency ?? new InMemoryIdempotencyStore();
  const outbox = overrides.outbox ?? new InMemoryEventOutbox();
  const audit = overrides.audit ?? new InMemoryAuditLogger();
  const scans = overrides.scans ?? new RecordingScanQueue();
  const planLimiter = overrides.planLimiter ?? new FakePlanLimiter();
  const grants = overrides.grants ?? new InMemoryWriteGrantStore();
  const identities = overrides.identities ?? new InMemoryIdentityStore();
  const folders = overrides.folders ?? new InMemoryFolderRepository();
  // ADR-0078: the third canWrite leg. reUpload runs through canWrite, so the
  // upload harness has to carry it even though no upload test grants one.
  const orgWriteGrants = new InMemoryOrgWriteGrantStore();

  const deps: UploadReportDeps = {
    orgWriteGrants,
    folders,
    reports,
    blobs,
    bundles,
    idempotency,
    outbox,
    audit,
    scans,
    planLimiter,
    grants,
    identities,
    ids: new SequentialIdGenerator(),
    slugs: new SequentialSlugFactory(),
    hasher: new FakeHasher(),
    uow: new PassThroughUnitOfWork(),
  };

  return {
    deps,
    folders,
    reports,
    blobs,
    bundles,
    idempotency,
    outbox,
    audit,
    scans,
    planLimiter,
    grants,
    identities,
  };
}
