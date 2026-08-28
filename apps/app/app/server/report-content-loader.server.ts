// Load a report VERSION's stored document by slug (issue #312) — the
// server-layer helper behind GET /api/v1/reports/{slug}/content, the
// authenticated/MCP read-back that lets an agent fetch a report's current HTML
// (to update it in place) instead of blind-overwriting or rebuilding it.
//
// Auth is the SAME `getReport` seam diff/versions use (loadReadableReport —
// org-visible OR write-grantee, ADR-0059 §3 / ADR-0060 §4); an edit-token
// actor's `orgId` is the report's own current org, so the guard is satisfied
// trivially once the token has been accepted. This mirrors report-diff-loader
// exactly — the diff endpoint already reads version content over this seam;
// this returns the bytes it diffs.
//
// The returned `html` is served byte-for-byte from storage (ADR-0038) and is
// UNTRUSTED content (ADR-0069) — a consumer treats it as DATA. `source` is the
// lossless `_source.json` ProseMirror sidecar (ADR-0062 §4), read only when
// asked for (`includeSource`) and present only when the version carries one.
import {
  type BlobStore,
  type CanWriteDeps,
  getReport,
  type ReportRepository,
  type TenancyActor,
} from "arp-application";
import {
  type AppError,
  err,
  notFound,
  ok,
  type Result,
  type Slug,
  type VersionId,
} from "arp-domain";

export interface LoadReportContentDeps extends CanWriteDeps {
  readonly reports: ReportRepository;
  readonly blobs: BlobStore;
}

export interface LoadReportContentInput {
  /** A specific version's External Id. Omitted ⇒ the report's live version. */
  readonly versionId?: VersionId;
  /** Also read + return the version's `_source.json` sidecar when it has one. */
  readonly includeSource?: boolean;
}

export interface LoadedReportContent {
  readonly slug: string;
  readonly versionId: VersionId;
  readonly versionNo: number;
  readonly contentType: string;
  readonly html: string;
  readonly source?: unknown;
}

export async function loadReportContent(
  deps: LoadReportContentDeps,
  actor: TenancyActor,
  slug: Slug,
  input: LoadReportContentInput,
): Promise<Result<LoadedReportContent, AppError>> {
  const reportR = await getReport(
    { reports: deps.reports, grants: deps.grants, identities: deps.identities },
    actor,
    { slug },
  );
  if (!reportR.ok) return reportR;
  const report = reportR.value;

  const version = input.versionId
    ? report.versions.find((v) => v.id === input.versionId)
    : report.versions.find((v) => v.id === report.liveVersionId);
  if (!version) {
    return err(notFound(input.versionId ? "version not found" : "no live version"));
  }

  const htmlR = await deps.blobs.readObject(report.id, version.id, version.manifest.entryDocument);
  if (!htmlR.ok) return htmlR;
  if (!htmlR.value) {
    // A version row with no stored entry document is a storage/data-integrity
    // inconsistency, not a client error — surface it as 500, like the diff
    // loader's "a version's HTML is missing" guard.
    return err({ kind: "Unexpected", message: "the version's content is missing" });
  }
  const html = new TextDecoder().decode(htmlR.value.bytes);

  let source: unknown;
  if (input.includeSource) {
    const sidecarR = await deps.blobs.readObject(report.id, version.id, "_source.json");
    if (sidecarR.ok && sidecarR.value) {
      try {
        source = JSON.parse(new TextDecoder().decode(sidecarR.value.bytes));
      } catch {
        // A corrupt sidecar is not a read failure — the served HTML is still
        // authoritative. Degrade to "no source" rather than failing the read.
        source = undefined;
      }
    }
  }

  return ok({
    slug,
    versionId: version.id,
    versionNo: version.versionNo,
    contentType: htmlR.value.contentType,
    html,
    ...(source !== undefined ? { source } : {}),
  });
}
