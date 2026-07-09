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
  type VersionOrigin,
} from "arp-domain";
import { canWrite, type WriteGrantCheckDeps } from "../load-owned";
import type {
  AuditLogger,
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

export interface UploadReportDeps extends WriteGrantCheckDeps {
  readonly reports: ReportRepository;
  readonly blobs: BlobStore;
  readonly bundles: BundleProcessor;
  readonly idempotency: IdempotencyStore;
  readonly outbox: EventOutbox;
  /** Audit log (ADR-0070) — one `report.uploaded` row per fresh upload/re-upload. */
  readonly audit: AuditLogger;
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
  /** How this version was produced (ADR-0062 §6 / ADR-0065). Defaults to
   *  `upload` — every /api/v1/reports call site is a plain upload; the
   *  editor's saveEditedVersion wrapper sets `editor`. */
  readonly origin?: VersionOrigin;
  /**
   * The ProseMirror document JSON (ADR-0062 §4) — persisted as the
   * `_source.json` lossless sidecar alongside the version's blobs. Opaque
   * `Record<string, unknown>` here (not a `PMDocJson` import from
   * arp-report-html): the application layer stays free of the ProseMirror
   * dependency (ADR-024) and only ever treats this as bytes to store.
   * SECURITY-CRITICAL: this sidecar is written to the blob store but is
   * deliberately NOT added to the version's `VersionManifest` — the viewer
   * serves version content by manifest-listed path, and the sidecar must
   * never be publicly fetchable (view.<domain>/<slug>/_source.json).
   * Undefined ⇒ no sidecar is written (a plain upload/re-upload).
   */
  readonly sourceDoc?: Record<string, unknown>;
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
  //
  // SECURITY/CORRECTNESS (PR #151 review, Fix 3): `bundle.contentHash` alone
  // is a hash of the serialized HTML BYTES, not of the ProseMirror doc that
  // produced them. Two editor saves can serialize to byte-identical HTML
  // while carrying genuinely different `sourceDoc` JSON (e.g. an edit that
  // doesn't change the rendered markup) — without folding sourceDoc into the
  // key/fingerprint, the second save would be misidentified as an idempotent
  // replay of the first and its `_source.json` sidecar would silently never
  // be written, breaking ADR-0062 §4 losslessness. Folding a stable hash of
  // the canonicalized sourceDoc JSON into BOTH the derived key input and the
  // fingerprint (only when `cmd.sourceDoc` is present — a plain upload/
  // re-upload has none, and keeps its exact prior behavior) fixes this: a
  // different doc ⇒ a different key ⇒ "proceed", not "replay"; the SAME doc
  // resubmitted still hashes identically ⇒ still replays (the correct
  // double-submit dedup).
  const target = cmd.updateSlug ? `slug:${cmd.updateSlug}` : `folder:${cmd.actor.folderId}`;
  const sourceDocFingerprint = cmd.sourceDoc
    ? deps.hasher.hash(canonicalJson(cmd.sourceDoc))
    : null;
  const ref = {
    actingUserId: cmd.actor.userId,
    route: ROUTE,
    // Derived key = hash(user ∥ route ∥ content_hash ∥ target [∥ sourceDoc_hash]),
    // ADR-0039 + Fix 3 above. The \n separator can't occur in the segments,
    // so no concat-collision.
    key:
      cmd.idempotencyKey ??
      deps.hasher.hash(
        [cmd.actor.userId, ROUTE, bundle.contentHash, target, sourceDocFingerprint ?? ""].join(
          "\n",
        ),
      ),
  };
  const fingerprint = sourceDocFingerprint
    ? `${bundle.contentHash}:${target}:${sourceDocFingerprint}`
    : `${bundle.contentHash}:${target}`;
  const begun = await deps.idempotency.begin(ref, fingerprint);
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
    ? reUpload(deps, cmd.updateSlug, cmd.actor, bundle, cmd.origin)
    : create(deps, cmd, bundle));
  if (!emission.ok) return emission;
  const { report, events } = emission.value;
  const newVersion = report.versions[report.versions.length - 1];
  if (!newVersion) return err({ kind: "Unexpected", message: "no version after transition" });

  // 6. Blobs first (R2-first; commit-last, ADR-0037 §5). The `_source.json`
  //    sidecar (ADR-0062 §4), when present, is appended to what's WRITTEN but
  //    is never added to `bundle.files` / the manifest (built below from
  //    `bundle.files` alone) — see the SECURITY-CRITICAL note on `sourceDoc`.
  const filesToWrite = cmd.sourceDoc ? [...bundle.files, sidecarFile(cmd.sourceDoc)] : bundle.files;
  const put = await deps.blobs.putVersionBundle(report.id, newVersion.id, filesToWrite);
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
    const audited = await deps.audit.record([
      {
        action: "report.uploaded",
        orgId: cmd.actor.orgId,
        actorUserId: cmd.actor.userId,
        targetType: "report",
        targetId: report.id,
        meta: { versionId: newVersion.id },
      },
    ]);
    if (!audited.ok) return audited;
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

/** Deterministic JSON encoding of a value — object keys sorted recursively so
 *  two structurally-equal `sourceDoc` values always hash the same regardless
 *  of key insertion order (Fix 3, see the idempotency comment above). */
function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
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

/** The version manifest persisted with the row: entry document + file paths.
 *  NEVER includes the `_source.json` sidecar (ADR-0062 §4) — see `sourceDoc`
 *  on `UploadCommand`; the sidecar is written to the blob store separately
 *  (step 6) and must stay outside this allowlist. */
function manifestOf(bundle: ProcessedBundle): VersionManifest {
  return { entryDocument: bundle.entryDocument, files: bundle.files.map((f) => f.path) };
}

/** The ProseMirror doc JSON, encoded as the `_source.json` sidecar blob
 *  (ADR-0062 §4) — deliberately never a member of `bundle.files` / the
 *  manifest (see `manifestOf`). */
function sidecarFile(doc: Record<string, unknown>) {
  return {
    path: "_source.json",
    contentType: "application/json",
    bytes: new TextEncoder().encode(JSON.stringify(doc)),
  };
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
        origin: cmd.origin ?? "upload", // ADR-0065 — 'editor' for an edit-save
      }),
    ),
  );
}

async function reUpload(
  deps: UploadReportDeps,
  updateSlug: string,
  actor: UploadActor,
  bundle: ProcessedBundle,
  origin: VersionOrigin | undefined,
) {
  const slugR = makeSlug(updateSlug);
  if (!slugR.ok) return slugR;
  const found = await deps.reports.findBySlug(slugR.value);
  if (!found.ok) return found;
  if (!found.value) return err(notFound("report not found"));
  // deletedAt is intentionally NOT filtered here (unlike loadWritableReport):
  // whether re-upload should resurrect a soft-deleted slug is an OPEN QUESTION
  // in docs/diary.md — switching to the guard would silently decide it as "no".
  // The canWrite seam (ADR-0059 §2 / ADR-0060 §4: isOwner OR hasWriteGrant) —
  // replaces the old inline org check for re-upload. This is the SECOND
  // canWrite call site (the first is loadWritableReport, for rename/move) —
  // flagged by the G1 review as needing to move together.
  const allowed = await canWrite(found.value, actor, deps);
  if (!allowed.ok) return allowed;
  if (!allowed.value) return err(notAllowed("you do not have write access to this report"));
  return addVersion(found.value, {
    versionId: deps.ids.versionId(),
    contentHash: bundle.contentHash,
    uploadedBy: actor.userId,
    manifest: manifestOf(bundle),
    sizeBytes: bundle.sizeBytes,
    origin: origin ?? "upload", // ADR-0065 — 'editor' for an edit-save
  });
}
