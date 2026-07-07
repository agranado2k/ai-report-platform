// UploadReportUseCase — the content-only upload pipeline (ADR-0037, ADR-0039).
// Pure orchestration over the driven ports (no I/O of its own; ADR-0024). The
// HTTP adapter maps the returned AppError to a status (ADR-0040) and a success
// to 201 { id, slug, view_url, version, scan_status }.

import {
  type AppError,
  addVersion,
  createReport,
  err,
  type FolderId,
  insufficientScope,
  makeSlug,
  notAllowed,
  notFound,
  type OrgId,
  ok,
  type ReportId,
  type Result,
  type ScanStatus,
  type UserId,
  type VersionId,
  type VersionManifest,
} from "arp-domain";
import { canWrite } from "../load-owned";
import type {
  BlobStore,
  BundleProcessor,
  EventOutbox,
  Hasher,
  IdempotencyStore,
  IdGenerator,
  PlanLimiter,
  ProcessedBundle,
  ReportRepository,
  ScanQueue,
  SlugFactory,
  UnitOfWork,
} from "../ports";

const ROUTE = "POST /api/v1/reports";
const WRITE_SCOPE = "reports:write";

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
  readonly hasher: Hasher;
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
  // Internal handles to the just-created version, so the caller can drive the
  // Phase-1 scan stub without a second findBySlug round-trip. Present only on a
  // fresh upload (undefined on idempotent replay — already scanned first time).
  readonly reportId?: ReportId;
  readonly versionId?: VersionId;
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
    // Derived key = hash(user ∥ route ∥ content_hash ∥ target), ADR-0039. The
    // \n separator can't occur in the segments, so no concat-collision.
    key:
      cmd.idempotencyKey ??
      deps.hasher.hash([cmd.actor.userId, ROUTE, bundle.contentHash, target].join("\n")),
  };
  const begun = await deps.idempotency.begin(ref, `${bundle.contentHash}:${target}`);
  if (!begun.ok) return begun; // reuse w/ different body → 422
  if (begun.value.outcome === "in_flight")
    return err({ kind: "IdempotencyInFlight", message: "request in flight" });
  if (begun.value.outcome === "replay") {
    const prior = parseUploadResult(begun.value.record.responseBody);
    if (!prior.ok) return prior;
    return ok({ result: prior.value, replayed: true });
  }

  // 4. Plan limits.
  const plan = await deps.planLimiter.assertWithinPlan(cmd.actor.orgId);
  if (!plan.ok) return plan;

  // 5. Resolve create vs re-upload, run the domain transition.
  const emission = await (cmd.updateSlug
    ? reUpload(deps, cmd.updateSlug, cmd.actor, bundle)
    : create(deps, cmd, bundle));
  if (!emission.ok) return emission;
  const { report, events } = emission.value;
  const newVersion = report.versions[report.versions.length - 1];
  if (!newVersion) return err({ kind: "Unexpected", message: "no version after transition" });

  // 6. Blobs first (R2-first; commit-last, ADR-0037 §5).
  const put = await deps.blobs.putVersionBundle(report.id, newVersion.id, bundle.files);
  if (!put.ok) return put;

  // 7. Atomic commit: report + outbox + idempotency record (ADR-0037 §5, ADR-0039).
  const result: UploadResult = {
    slug: report.slug,
    version: newVersion.versionNo,
    scanStatus: newVersion.scanStatus,
  };
  const committed = await deps.uow.run(async () => {
    const saved = await deps.reports.save(report);
    if (!saved.ok) return saved;
    const enq = await deps.outbox.enqueue(events);
    if (!enq.ok) return enq;
    return deps.idempotency.complete(ref, { responseStatus: 201, responseBody: result });
  });
  if (!committed.ok) {
    // Best-effort cleanup; we return the original commit error, and the periodic
    // GC sweep reclaims any orphan blobs left behind (ADR-0037 §5).
    await deps.blobs.deleteVersionPrefix(report.id, newVersion.id);
    return committed;
  }

  // 8. Enqueue the scan. The caller drives it to a verdict via processScanResult
  //    (Phase-1 stub: synchronously clean; Phase 1.5: the real scanner worker).
  const scan = await deps.scans.enqueueScan(report.id, newVersion.id);
  if (!scan.ok) return scan;

  return ok({ result, replayed: false, reportId: report.id, versionId: newVersion.id });
}

function parseUploadResult(body: unknown): Result<UploadResult, AppError> {
  const b = body as Record<string, unknown> | null;
  if (
    !b ||
    typeof b.slug !== "string" ||
    typeof b.version !== "number" ||
    typeof b.scanStatus !== "string"
  ) {
    return err({
      kind: "Unexpected",
      message: "stored idempotency response is not a valid UploadResult",
    });
  }
  return ok(b as unknown as UploadResult);
}

/** The version manifest persisted with the row: entry document + file paths. */
function manifestOf(bundle: ProcessedBundle): VersionManifest {
  return { entryDocument: bundle.entryDocument, files: bundle.files.map((f) => f.path) };
}

function create(deps: UploadReportDeps, cmd: UploadCommand, bundle: ProcessedBundle) {
  return Promise.resolve(
    ok(
      createReport({
        id: deps.ids.reportId(),
        orgId: cmd.actor.orgId,
        folderId: cmd.actor.folderId,
        slug: deps.slugs.newSlug(),
        title: cmd.title ?? "Untitled report",
        versionId: deps.ids.versionId(),
        contentHash: bundle.contentHash,
        uploadedBy: cmd.actor.userId,
        manifest: manifestOf(bundle),
        sizeBytes: bundle.sizeBytes,
      }),
    ),
  );
}

async function reUpload(
  deps: UploadReportDeps,
  updateSlug: string,
  actor: UploadActor,
  bundle: ProcessedBundle,
) {
  const slugR = makeSlug(updateSlug);
  if (!slugR.ok) return slugR;
  const found = await deps.reports.findBySlug(slugR.value);
  if (!found.ok) return found;
  if (!found.value) return err(notFound("report not found"));
  // The canWrite seam (ADR-0059 §2; ADR-0060 extends it with write grants) —
  // replaces the old inline org check for re-upload.
  if (!canWrite(found.value, actor))
    return err(notAllowed("you do not have write access to this report"));
  return addVersion(found.value, {
    versionId: deps.ids.versionId(),
    contentHash: bundle.contentHash,
    uploadedBy: actor.userId,
    manifest: manifestOf(bundle),
    sizeBytes: bundle.sizeBytes,
  });
}
