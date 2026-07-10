// The editor-save reassembly helper (ADR-0062 §5 / ADR-0063 API slice) —
// factored out of reports.$slug.edit.tsx's action so the dashboard editor
// route AND the new edit-token-authenticatable POST
// /api/v1/reports/{slug}/versions route share ONE implementation instead of
// two copies that could silently drift. Mirrors EXACTLY what the dashboard
// route used to do inline: re-read the CURRENT editable version's shell
// (never the loader's stale snapshot — a concurrent save could have moved
// it), serialize the caller's ProseMirror doc back to body HTML, re-inject
// it into that shell, then run the whole reassembled document through
// saveEditedVersion (the existing ADR-0037 upload pipeline, `origin:
// 'editor'`, with the lossless `_source.json` sidecar).
//
// Authorization is layered exactly like re-upload's: `loadWritableReport`
// here (so a non-owner/non-grantee gets a clean NotAllowed before any R2/DB
// write is attempted, and so the CORRECT current version's shell is read),
// PLUS saveEditedVersion's own `canWrite` re-check inside uploadReport's
// `reUpload` path (belt-and-braces — the second check is what protects a
// caller who somehow reaches saveEditedVersion directly, bypassing this
// helper). Both checks are the SAME `isOwner OR hasWriteGrant` seam
// (ADR-0059 §2 / ADR-0060 §4), so a non-owner/non-grantee is denied
// identically either way.
import {
  loadWritableReport,
  saveEditedVersion,
  type UploadActor,
  type UploadOutcome,
  type UploadReportDeps,
} from "arp-application";
import type { ReportVersion } from "arp-domain";
import { type AppError, err, type Result, type Slug } from "arp-domain";
import { type PMDocJson, reinjectShell, serializeBody, splitShell } from "arp-report-html";

/** The version an editor session opens/saves against: the live version when
 *  one has been published, else the newest by `version_no` (a fresh upload
 *  that hasn't cleared scan yet must still be openable/editable, ADR-0062
 *  §5). Shared by the loader (reports.$slug.edit.tsx) and this save helper —
 *  BOTH must agree on which version is "current", or a save could re-inject
 *  the wrong shell. */
export function editableVersion(report: {
  readonly liveVersionId: ReportVersion["id"] | null;
  readonly versions: readonly ReportVersion[];
}): ReportVersion | undefined {
  const newest = [...report.versions].sort((a, b) => b.versionNo - a.versionNo)[0];
  if (!report.liveVersionId) return newest;
  return report.versions.find((v) => v.id === report.liveVersionId) ?? newest;
}

/** Pure: re-inject a freshly-serialized ProseMirror body into the CURRENT
 *  version's shell (its `<head>`/`<body ...>` wrapper), producing the whole
 *  document to upload. Extracted standalone so this exact transformation is
 *  unit-testable without the upload pipeline (the shared `FakeBundleProcessor`
 *  test double returns a CANNED file list regardless of input bytes, so
 *  round-tripping through `uploadReport` can't observe this step directly). */
export function reassembleEditedHtml(currentHtml: string, doc: PMDocJson): string {
  const { shell } = splitShell(currentHtml);
  const bodyHtml = serializeBody(doc);
  return reinjectShell(shell, bodyHtml);
}

/**
 * Re-assemble the report's current shell around a freshly-edited
 * ProseMirror body, and save it as a new editor-origin `ReportVersion`.
 * `deps` is the SAME `UploadReportDeps` the container's `deps()` builds
 * (carries `grants`/`identities` for the `canWrite` seam alongside the
 * upload/blob-store ports).
 */
export async function reassembleAndSaveEditedVersion(
  deps: UploadReportDeps,
  actor: UploadActor,
  slug: Slug,
  doc: PMDocJson,
): Promise<Result<UploadOutcome, AppError>> {
  const found = await loadWritableReport(deps.reports, actor, slug, {
    grants: deps.grants,
    identities: deps.identities,
  });
  if (!found.ok) return found;
  const report = found.value;

  const version = editableVersion(report);
  if (!version) return err({ kind: "NotFound", message: "report has no version" });

  const htmlBlob = await deps.blobs.readObject(
    report.id,
    version.id,
    version.manifest.entryDocument,
  );
  if (!htmlBlob.ok || !htmlBlob.value) {
    return err({ kind: "Unexpected", message: "editable version's HTML is missing" });
  }
  const wholeHtml = reassembleEditedHtml(new TextDecoder().decode(htmlBlob.value.bytes), doc);

  return saveEditedVersion(deps, {
    actor,
    slug,
    html: new TextEncoder().encode(wholeHtml),
    sourceDoc: doc as unknown as Record<string, unknown>,
  });
}
