// UploadReportUseCase — the content-only upload pipeline (ADR-0037, ADR-0039).
// Pure orchestration over the driven ports (no I/O of its own; ADR-0024). The
// HTTP adapter maps the returned AppError to a status (ADR-0040) and a success
// to 201 { id, slug, view_url, version, scan_status }.

import {
  type Acl,
  type AppError,
  addVersion,
  createReport,
  DEFAULT_ACL,
  err,
  type FolderId,
  inheritedVisibility,
  insufficientScope,
  makeSlug,
  notAllowed,
  notFound,
  type OrgId,
  ok,
  REPORTS_WRITE_SCOPE,
  type ReportId,
  type Result,
  type ScanStatus,
  type UserId,
  type VersionEditability,
  type VersionFidelity,
  type VersionId,
  type VersionManifest,
  type VersionOrigin,
} from "arp-domain";
import { type CanWriteDeps, canWrite } from "../load-owned";
import type {
  AuditLogger,
  BlobStore,
  BlockedExternalResource,
  BundleProcessor,
  EditabilityProbe,
  EventOutbox,
  FidelityProbe,
  FidelityVerdict,
  FolderRepository,
  Hasher,
  IdempotencyStore,
  IdGenerator,
  PlanLimiter,
  ProcessedBundle,
  ReportRepository,
  ResourceScanner,
  ScanQueue,
  SlugFactory,
  UnitOfWork,
} from "../ports";

const ROUTE = "POST /api/v1/reports";

export interface UploadReportDeps extends CanWriteDeps {
  readonly reports: ReportRepository;
  /** The folder tree — read ONLY to derive a NEW report's initial sharing from
   *  its destination folder (ADR-0078 §6). Never consulted on re-upload. */
  readonly folders: FolderRepository;
  readonly blobs: BlobStore;
  readonly bundles: BundleProcessor;
  /** The editor's own open-time precondition (ADR-0080), run at write time so
   *  "views fine, won't edit" is a recorded state rather than a surprise. */
  readonly editability: EditabilityProbe;
  /** What a save through the editor would COST this version (ADR-0090) — the
   *  orthogonal twin, run at the same moment through the same seam. */
  readonly fidelity: FidelityProbe;
  /** What the VIEWER will refuse to load out of this document (#365) — the
   *  third write-time question, asked while the author still holds the bytes. */
  readonly resources: ResourceScanner;
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

/**
 * What an upload has to TELL its author about what they just published (#365).
 *
 * A closed set of codes, because the consumer is usually an agent: MCP is this
 * product's primary write surface, and an agent that can branch on a code can
 * fix the document and re-upload before a human ever opens it. A free-text
 * message alone would be readable and un-actionable.
 *
 * - `external-resource-blocked` — the document references a URL the viewer's
 *   CSP (ADR-0088) will not load. One per blocked URL.
 * - `editor-lossy` — this version's recorded Fidelity (ADR-0090) is `lossy`:
 *   opening it in the editor and saving would drop part of the document.
 *
 * A warning is ADVISORY and never a rejection: it does not change the status
 * code, does not fail the upload, and the bytes are stored and served exactly
 * as uploaded either way. Publishing view-only content, or content that reaches
 * for a host the viewer blocks, is a legitimate thing to do.
 */
export type UploadWarningCode = "external-resource-blocked" | "editor-lossy";

export interface UploadWarning {
  readonly code: UploadWarningCode;
  /** A sentence naming the specific thing and what to do about it. */
  readonly detail: string;
}

export interface UploadResult {
  readonly slug: string;
  readonly version: number;
  readonly scanStatus: ScanStatus;
  /** This version's recorded Editability (ADR-0080); `null` when nothing could
   *  be probed. Returned on the upload response so an agent — MCP is this
   *  product's primary write surface — learns immediately that what it just
   *  published views fine and will not open in the editor. */
  readonly editability: VersionEditability | null;
  /** What the author should know about what they just published (#365). ALWAYS
   *  present — an upload with nothing to say carries an empty list, never an
   *  absent field, so a client can tell "no warnings" from "an old server". */
  readonly warnings: readonly UploadWarning[];
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
  if (!cmd.actor.scopes.includes(REPORTS_WRITE_SCOPE))
    return err(insufficientScope(REPORTS_WRITE_SCOPE));

  // 2. Sync pre-checks (MIME/zip/entry-doc/caps) + content hash.
  const processed = await deps.bundles.process(cmd.upload.filename, cmd.upload.bytes);
  if (!processed.ok) return processed;
  const bundle = processed.value;

  // 2b. Initial sharing, inherited from the DESTINATION folder (ADR-0078 §6).
  //
  // Resolved BEFORE the idempotency claim on purpose: a failure here must not
  // leave an in-flight key behind for a request that will never complete.
  //
  // Create-only. A re-upload keeps whatever sharing the report already has —
  // inheritance is a CREATE-time rule (ADR-0078 §7's reasoning, applied to the
  // other write path): re-deriving it later would let a folder move, or a
  // write-grantee's re-upload, silently publish content its owner made private.
  const initialAcl = cmd.updateSlug ? null : await resolveInheritedAcl(deps, cmd.actor.folderId);
  if (initialAcl !== null && !initialAcl.ok) return initialAcl;

  // 2c. Editability (ADR-0080). Metadata ABOUT the bytes, never a
  // transformation OF them, and never a rejection: an un-editable document is
  // stored, served and versioned exactly like any other — this only makes the
  // state knowable before a user discovers it as a silent redirect.
  const editability = probeEditability(deps, bundle, cmd.sourceDoc !== undefined);

  // 2d. Fidelity (ADR-0090). The orthogonal question: not whether the editor
  // can OPEN these bytes but whether it would KEEP them. Probed ONLY when the
  // answer to the first question is `editable` — on bytes the editor cannot
  // split or parse there is no round trip to run, so there is no honest
  // verdict and UNKNOWN is the only truthful answer. Never a rejection either:
  // publishing view-only content is legitimate.
  const fidelityVerdict =
    editability === "editable" ? probeFidelity(deps, bundle, cmd.sourceDoc !== undefined) : null;
  const fidelity = fidelityVerdict?.fidelity ?? null;

  // 2e. Upload warnings (#365). The two write-time questions above answer what
  // the EDITOR would do with these bytes; this one answers what the VIEWER
  // will, by scanning the document for references the ADR-0088 allowlist does
  // not cover. Assembled here, in the one place that already holds both
  // answers, so the HTTP response and the MCP tool cannot drift apart.
  //
  // Advisory, exactly like its inputs: warnings never change the status code
  // and never reject. And the scan never FETCHES what it finds — the uploaded
  // document is untrusted content (ADR-0069) and the port is synchronous so
  // that it cannot.
  const warnings = assembleWarnings(scanResources(deps, bundle), fidelityVerdict);

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
    ? reUpload(deps, cmd.updateSlug, cmd.actor, bundle, cmd.origin, editability, fidelity)
    : create(deps, cmd, bundle, editability, fidelity));
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
    editability: newVersion.editability,
    warnings,
  };
  const committed = await deps.uow.run(async () => {
    const saved = await deps.reports.save(report);
    if (!saved.ok) return saved;
    // The Acl lives in its own 1:1 row, which `save` deliberately does not
    // touch (only setAcl writes it) — so an inherited non-default Acl is
    // written here, inside the SAME transaction as the report itself. A report
    // that committed without its inherited sharing would be a privacy defect
    // in the safe direction on create, and an unexplained one on retry.
    if (initialAcl !== null && initialAcl.ok && initialAcl.value.mode !== DEFAULT_ACL.mode) {
      const acled = await deps.reports.setAcl(report.id, initialAcl.value);
      if (!acled.ok) return acled;
    }
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
    typeof b.scanStatus !== "string" ||
    // Present-but-nullable: a replayed record stored before ADR-0080 has no
    // `editability` key at all, and rejecting it would turn every pre-existing
    // in-flight idempotency record into a 500. `undefined` is normalized to
    // `null` (UNKNOWN) below — the same honest answer the column gives.
    (b.editability !== undefined && b.editability !== null && typeof b.editability !== "string") ||
    // Present-but-optional for the same reason, one change later: a record
    // stored before #365 has no `warnings` key, and reading it as a 500 would
    // punish every in-flight upload across the deploy that adds them.
    (b.warnings !== undefined && !Array.isArray(b.warnings))
  ) {
    return err({
      kind: "Unexpected",
      message: "stored idempotency response is not a valid UploadResult",
    });
  }
  return ok({
    ...(b as unknown as UploadResult),
    editability: (b.editability ?? null) as VersionEditability | null,
    warnings: (b.warnings ?? []) as readonly UploadWarning[],
  });
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

/**
 * Ask the probe about the bytes that will actually be stored as the entry
 * document (ADR-0080).
 *
 * A bundle whose manifest names an entry document that is not among its files
 * is a shape only a future zip processor could produce; there is nothing to
 * probe, so the verdict is UNKNOWN (`null`) — the same honest answer the
 * migration gives pre-existing rows. Guessing `editable` here would be the
 * exact false assurance this ADR exists to remove.
 */
function probeEditability(
  deps: Pick<UploadReportDeps, "editability">,
  bundle: ProcessedBundle,
  hasSourceDoc: boolean,
): VersionEditability | null {
  const entry = bundle.files.find((f) => f.path === bundle.entryDocument);
  if (!entry) return null;
  return deps.editability.probe(entry.bytes, hasSourceDoc);
}

/**
 * The fidelity twin (ADR-0090). Same UNKNOWN rule for the same reason: with no
 * entry-document bytes there is nothing to round-trip, and guessing `lossless`
 * would be the false assurance the field exists to remove.
 *
 * Only the VERDICT is persisted (ADR-0090 §3). The WHOLE verdict is returned
 * here because the lost items are what the `editor-lossy` warning names (#365):
 * "this edit is lossy" without a subject is an alarm nobody can act on.
 */
function probeFidelity(
  deps: Pick<UploadReportDeps, "fidelity">,
  bundle: ProcessedBundle,
  hasSourceDoc: boolean,
): FidelityVerdict | null {
  const entry = bundle.files.find((f) => f.path === bundle.entryDocument);
  if (!entry) return null;
  return deps.fidelity.probe(entry.bytes, hasSourceDoc);
}

/**
 * Ask the scanner what the viewer will refuse to load (#365).
 *
 * Same UNKNOWN rule as its two siblings, with the same consequence: no entry
 * document means nothing to read, so the honest answer is "nothing found" —
 * which here is also the safe one, because an absent warning costs a hint,
 * never a security decision.
 */
function scanResources(
  deps: Pick<UploadReportDeps, "resources">,
  bundle: ProcessedBundle,
): readonly BlockedExternalResource[] {
  const entry = bundle.files.find((f) => f.path === bundle.entryDocument);
  if (!entry) return [];
  return deps.resources.scan(entry.bytes);
}

/**
 * Turn the two write-time findings into the author-facing list (#365).
 *
 * Ordering is deliberate and stable: the blocked resources first, in the order
 * the document references them, then the editor verdict. Resource warnings are
 * per-URL and immediately fixable in the document; the editor one is a single
 * statement about the whole thing, and reads as the summary it is when it comes
 * last.
 */
/**
 * How many blocked resources are named individually.
 *
 * A bound, not a preference. The scan is total over an untrusted document, so
 * a few KB of repeated `<img>` tags produced a warning each: a multi-MB
 * response, and the same list persisted verbatim into the idempotency record
 * inside the commit transaction. Fifty named resources is already more than an
 * author will work through by hand, and the rest are summarised rather than
 * dropped.
 */
const MAX_RESOURCE_WARNINGS = 50;

/**
 * How much of a URL is quoted back.
 *
 * The URL is attacker-controlled text from the uploaded document, and this
 * text is handed to an agent by `reports_upload`. It is bounded so a document
 * cannot use the warning list as a channel for a payload of arbitrary size.
 */
const MAX_URL_IN_DETAIL = 300;

function assembleWarnings(
  blocked: readonly BlockedExternalResource[],
  fidelity: FidelityVerdict | null,
): readonly UploadWarning[] {
  const named = blocked.slice(0, MAX_RESOURCE_WARNINGS);
  const warnings: UploadWarning[] = named.map((resource) => ({
    code: "external-resource-blocked" as const,
    detail: blockedResourceDetail(resource),
  }));
  const remaining = blocked.length - named.length;
  if (remaining > 0) {
    // Summarised, never silently dropped: a list that just stopped would tell
    // the author the rest of their document is fine.
    warnings.push({
      code: "external-resource-blocked",
      detail:
        `…and ${remaining} more external resources will be blocked by the viewer's ` +
        `Content-Security-Policy. The first ${MAX_RESOURCE_WARNINGS} are named above. ` +
        "The report still publishes and views — only these resources will not load.",
    });
  }
  if (fidelity?.fidelity === "lossy") {
    warnings.push({ code: "editor-lossy", detail: lossyDetail(fidelity) });
  }
  return warnings;
}

/**
 * A URL from the uploaded document, made safe to quote back.
 *
 * The scan reports the URL exactly as the document writes it — that is its
 * contract, and the string the author searches for. Presenting it is a
 * different job. This text travels to an agent through `reports_upload`, so
 * the bytes an uploader chose are UNTRUSTED CONTENT arriving on an agent's
 * input (ADR-0069): control characters are collapsed so a `src` cannot forge
 * line structure in whatever is reading the response, and the length is
 * bounded so the warning list cannot carry an arbitrary payload. Neither makes
 * hostile text harmless — nothing here can — but both remove the shapes that
 * let it pretend to be something other than a URL the document contained.
 */
function displayUrl(url: string): string {
  const overlong = url.length > MAX_URL_IN_DETAIL;
  // Bound FIRST, then rewrite: the input is attacker-sized, and there is no
  // reason to walk 50 KB to render 300 characters of it.
  const bounded = overlong ? url.slice(0, MAX_URL_IN_DETAIL) : url;
  const flattened = Array.from(bounded, (ch) => (isControlChar(ch) ? " " : ch))
    .join("")
    .trim();
  return overlong ? `${flattened}… (truncated)` : flattened;
}

/** A C0 control character or DEL — the codes that let text forge line and field
 *  structure in whatever renders it. Written as a code comparison rather than a
 *  character class because a control character in a regex is itself a lint
 *  error (`noControlCharactersInRegex`), and rightly so. */
function isControlChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return code < 0x20 || code === 0x7f;
}

function blockedResourceDetail({ url, directive, allowed }: BlockedExternalResource): string {
  const permitted =
    allowed.length > 0
      ? `${directive} allows only ${allowed.join(", ")}`
      : directive === "frame-src"
        ? // The public viewer policy declares NO `frame-src` (ADR-0088) — frames
          // are governed by the `default-src` fallback. Naming a directive the
          // policy does not have would tell an agent there is one to widen.
          "frames fall back to default-src 'self', which allows no external host"
        : `${directive} allows no external host`;
  return (
    `${displayUrl(url)} will be blocked by the viewer's Content-Security-Policy: ${permitted}. ` +
    "Inline the asset (a data: URI works) or load it from an allowed host. " +
    "The report still publishes and views — only this resource will not load."
  );
}

function lossyDetail({ lostElements, lostAttributes }: FidelityVerdict): string {
  const parts: string[] = [];
  if (lostElements.length > 0) parts.push(`elements: ${lostElements.join(", ")}`);
  if (lostAttributes.length > 0) parts.push(`attributes: ${lostAttributes.join(", ")}`);
  const what = parts.length > 0 ? ` It would drop ${parts.join("; ")}.` : "";
  return (
    "Opening this report in the editor and saving it would not keep the whole document." +
    `${what} The published bytes are served untouched (ADR-0038) — this affects only a ` +
    "save made through the editor."
  );
}

function create(
  deps: UploadReportDeps,
  cmd: UploadCommand,
  bundle: ProcessedBundle,
  editability: VersionEditability | null,
  fidelity: VersionFidelity | null,
) {
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
        editability, // ADR-0080 — null when nothing could be probed
        fidelity, // ADR-0090 — null when unprobed OR not `editable`
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
  editability: VersionEditability | null,
  fidelity: VersionFidelity | null,
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
    editability, // ADR-0080 — this version's own verdict, never v1's
    fidelity, // ADR-0090 — likewise per version
  });
}

/**
 * The Acl a NEW report inherits from the folder it is uploaded into
 * (ADR-0078 §6), precisely mirroring `inheritedVisibility` for child folders.
 *
 * THE ROOT CARVE-OUT IS THE WHOLE SAFETY PROPERTY. Root is permanently
 * org-visible (ADR-0076 §3) *and* is the default upload placement (ADR-0037),
 * so inheriting from it would make every upload in the product org-visible —
 * a silent, product-wide privacy regression shipped as a convenience. Root's
 * `org` visibility is a usability invariant, not a sharing intent, which is
 * exactly the reason `inheritedVisibility` already special-cases it.
 *
 * An UNRESOLVABLE folder falls back to `private`: an unknown destination must
 * never widen a report's reach. A folder-store ERROR propagates instead —
 * silently narrowing on infrastructure trouble is fine, but doing so without
 * anyone being able to tell the difference is not.
 *
 * THE CARVE-OUT IS NOT RE-IMPLEMENTED HERE. `inheritedVisibility` (ADR-0076 §3)
 * already IS this rule — "Root inherits `private`, everything else inherits its
 * own visibility" — for child folders, and ADR-0078 §6 chose it deliberately as
 * the model. A second byte-for-byte copy of the one rule that keeps every
 * upload in the product from becoming org-visible is a copy that can be edited
 * on one side only. So this function asks the domain and translates the answer
 * into an `Acl`; it does not decide.
 */
async function resolveInheritedAcl(
  deps: Pick<UploadReportDeps, "folders">,
  destination: FolderId,
): Promise<Result<Acl, AppError>> {
  const found = await deps.folders.findById(destination);
  if (!found.ok) return found;
  const folder = found.value;
  if (!folder || folder.deletedAt !== null) return ok(DEFAULT_ACL);
  return ok(inheritedVisibility(folder) === "org" ? { mode: "org" } : DEFAULT_ACL);
}
