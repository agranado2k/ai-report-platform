// UploadReportUseCase — the content-only upload pipeline (ADR-0037, ADR-0039).
// Pure orchestration over the driven ports (no I/O of its own; ADR-0024). The
// HTTP adapter maps the returned AppError to a status (ADR-0040) and a success
// to 201 { slug, view_url, version, scan_status }.

import {
  type AppError,
  type FolderId,
  type OrgId,
  type Result,
  type ScanStatus,
  type UserId,
  addVersion,
  createReport,
  err,
  insufficientScope,
  makeSlug,
  notAllowed,
  notFound,
  ok,
} from 'arp-domain';
import type {
  BlobStore,
  BundleProcessor,
  Clock,
  EventOutbox,
  IdGenerator,
  IdempotencyStore,
  PlanLimiter,
  ReportRepository,
  ScanQueue,
  SlugFactory,
  UnitOfWork,
} from '../ports';

const ROUTE = 'POST /api/v1/reports';
const WRITE_SCOPE = 'reports:write';

export interface UploadReportDeps {
  readonly reports: ReportRepository;
  readonly blobs: BlobStore;
  readonly bundles: BundleProcessor;
  readonly idempotency: IdempotencyStore;
  readonly outbox: EventOutbox;
  readonly scans: ScanQueue;
  readonly planLimiter: PlanLimiter;
  readonly ids: IdGenerator;
  readonly slugs: SlugFactory;
  readonly clock: Clock;
  readonly uow: UnitOfWork;
}

export interface UploadActor {
  readonly userId: UserId;
  readonly orgId: OrgId;
  readonly folderId: FolderId; // Phase 1: the org root folder
  readonly scopes: readonly string[];
}

export interface UploadCommand {
  readonly actor: UploadActor;
  readonly upload: { readonly filename: string; readonly bytes: Uint8Array };
  readonly idempotencyKey?: string;
  readonly updateSlug?: string; // re-upload
  readonly title?: string; // create only
}

export interface UploadResult {
  readonly slug: string;
  readonly version: number;
  readonly scanStatus: ScanStatus;
}

export interface UploadOutcome {
  readonly result: UploadResult;
  readonly replayed: boolean; // true → idempotent replay of a prior response
}

export async function uploadReport(
  deps: UploadReportDeps,
  cmd: UploadCommand,
): Promise<Result<UploadOutcome, AppError>> {
  // 1. Scope.
  if (!cmd.actor.scopes.includes(WRITE_SCOPE)) return err(insufficientScope(WRITE_SCOPE));

  // 2. Sync pre-checks (MIME/zip/entry-doc/caps) + content hash.
  const processed = await deps.bundles.process(cmd.upload.filename, cmd.upload.bytes);
  if (!processed.ok) return processed;
  const bundle = processed.value;

  // 3. Idempotency (ADR-0039): explicit key, else derived from user+route+hash+target.
  const target = cmd.updateSlug ? `slug:${cmd.updateSlug}` : `folder:${cmd.actor.folderId}`;
  const ref = {
    actingUserId: cmd.actor.userId,
    route: ROUTE,
    key: cmd.idempotencyKey ?? `${cmd.actor.userId}:${ROUTE}:${bundle.contentHash}:${target}`,
  };
  const begun = await deps.idempotency.begin(ref, `${bundle.contentHash}:${target}`);
  if (!begun.ok) return begun; // reuse w/ different body → 422
  if (begun.value.outcome === 'in_flight') return err({ kind: 'IdempotencyInFlight', message: 'request in flight' });
  if (begun.value.outcome === 'replay') {
    return ok({ result: begun.value.record.responseBody as UploadResult, replayed: true });
  }

  // 4. Plan limits.
  const plan = await deps.planLimiter.assertWithinPlan(cmd.actor.orgId);
  if (!plan.ok) return plan;

  // 5. Resolve create vs re-upload, run the domain transition.
  const emissionR = cmd.updateSlug
    ? await reUpload(deps, cmd.updateSlug, cmd.actor, bundle.contentHash)
    : create(deps, cmd, bundle.contentHash);
  const emission = await emissionR;
  if (!emission.ok) return emission;
  const { report, events } = emission.value;
  const newVersion = report.versions[report.versions.length - 1];
  if (!newVersion) return err({ kind: 'Unexpected', message: 'no version after transition' });

  // 6. Blobs first (R2-first; commit-last, ADR-0037 §5).
  const put = await deps.blobs.putVersionBundle(report.id, newVersion.id, bundle.files);
  if (!put.ok) return put;

  // 7. Atomic commit: report + outbox + idempotency record (ADR-0037 §5, ADR-0039).
  const result: UploadResult = { slug: report.slug, version: newVersion.versionNo, scanStatus: newVersion.scanStatus };
  const committed = await deps.uow.run(async () => {
    const saved = await deps.reports.save(report);
    if (!saved.ok) return saved;
    const enq = await deps.outbox.enqueue(events);
    if (!enq.ok) return enq;
    return deps.idempotency.complete(ref, { responseStatus: 201, responseBody: result });
  });
  if (!committed.ok) {
    await deps.blobs.deleteVersionPrefix(report.id, newVersion.id); // GC the orphan blobs
    return committed;
  }

  // 8. Enqueue the scan (Phase-1 stub yields clean → async promotion).
  const scan = await deps.scans.enqueueScan(report.id, newVersion.id);
  if (!scan.ok) return scan;

  return ok({ result, replayed: false });
}

function create(deps: UploadReportDeps, cmd: UploadCommand, contentHash: string) {
  return Promise.resolve(
    ok(
      createReport({
        id: deps.ids.reportId(),
        orgId: cmd.actor.orgId,
        folderId: cmd.actor.folderId,
        slug: deps.slugs.newSlug(),
        title: cmd.title ?? 'Untitled report',
        versionId: deps.ids.versionId(),
        contentHash,
        uploadedBy: cmd.actor.userId,
      }),
    ),
  );
}

async function reUpload(deps: UploadReportDeps, updateSlug: string, actor: UploadActor, contentHash: string) {
  const slugR = makeSlug(updateSlug);
  if (!slugR.ok) return slugR;
  const found = await deps.reports.findBySlug(slugR.value);
  if (!found.ok) return found;
  if (!found.value) return err(notFound('report not found'));
  // canWrite (Phase 1: same org; folder grants land with collaboration).
  if (found.value.orgId !== actor.orgId) return err(notAllowed('not allowed to update this report'));
  return addVersion(found.value, {
    versionId: deps.ids.versionId(),
    contentHash,
    uploadedBy: actor.userId,
  });
}
