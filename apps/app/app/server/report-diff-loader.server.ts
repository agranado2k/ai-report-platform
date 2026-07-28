// Load + compute a report diff by VERSION ID (ADR-0063 API slice) — the
// server-layer counterpart to reports.$slug.diff.tsx's loader, factored out
// so the dashboard diff page AND the new GET
// /api/v1/reports/{slug}/diff?from=<version_id>&to=<version_id> route (the
// cross-origin, edit-token-authenticatable JSON surface) share ONE
// load-and-decide implementation. Auth is the SAME `getReport` seam the
// dashboard route uses (loadReadableReport — org-visible OR write-grantee,
// ADR-0059 §3 / ADR-0060 §4): an edit-token actor's `orgId` is always the
// report's own current org (resolveEditTokenActor reads it off the same
// live row), so this guard is satisfied trivially once the token itself has
// already been accepted.
//
// UNLIKE the dashboard route (which addresses versions by their display
// ordinal, `?from=N&to=N`), this loader addresses versions by their
// `version_…` External Id — the wire id a client already holds from GET
// .../versions or a save response, and the only address a caller without DB
// access to translate an ordinal can use.
import {
  type BlobStore,
  getReport,
  type ReportRepository,
  type TenancyActor,
  type WriteGrantCheckDeps,
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
import { splitShell } from "arp-report-html";
import { computeReportDiff, type ReportDiffResult } from "./report-diff.server";

export interface LoadReportDiffDeps extends WriteGrantCheckDeps {
  readonly reports: ReportRepository;
  readonly blobs: BlobStore;
}

export interface LoadReportDiffInput {
  readonly fromVersionId: VersionId;
  readonly toVersionId: VersionId;
}

export interface LoadedReportDiff extends ReportDiffResult {
  readonly fromVersionId: VersionId;
  readonly toVersionId: VersionId;
  readonly fromVersionNo: number;
  readonly toVersionNo: number;
}

export async function loadReportDiff(
  deps: LoadReportDiffDeps,
  actor: TenancyActor,
  slug: Slug,
  input: LoadReportDiffInput,
): Promise<Result<LoadedReportDiff, AppError>> {
  const reportR = await getReport(
    { reports: deps.reports, grants: deps.grants, identities: deps.identities },
    actor,
    { slug },
  );
  if (!reportR.ok) return reportR;
  const report = reportR.value;

  const fromVersion = report.versions.find((v) => v.id === input.fromVersionId);
  const toVersion = report.versions.find((v) => v.id === input.toVersionId);
  if (!fromVersion || !toVersion) return err(notFound("version not found"));

  const [fromHtmlR, toHtmlR, fromSidecarR, toSidecarR] = await Promise.all([
    deps.blobs.readObject(report.id, fromVersion.id, fromVersion.manifest.entryDocument),
    deps.blobs.readObject(report.id, toVersion.id, toVersion.manifest.entryDocument),
    deps.blobs.readObject(report.id, fromVersion.id, "_source.json"),
    deps.blobs.readObject(report.id, toVersion.id, "_source.json"),
  ]);
  if (!fromHtmlR.ok || !fromHtmlR.value || !toHtmlR.ok || !toHtmlR.value) {
    return err({ kind: "Unexpected", message: "a version's HTML is missing" });
  }

  const fromBodyHtml = splitShell(new TextDecoder().decode(fromHtmlR.value.bytes)).bodyHtml;
  const toBodyHtml = splitShell(new TextDecoder().decode(toHtmlR.value.bytes)).bodyHtml;
  const fromSidecar = fromSidecarR.ok ? fromSidecarR.value : null;
  const toSidecar = toSidecarR.ok ? toSidecarR.value : null;

  const diff = computeReportDiff({
    fromBodyHtml,
    toBodyHtml,
    fromSidecarBytes: fromSidecar?.bytes ?? null,
    toSidecarBytes: toSidecar?.bytes ?? null,
  });

  return ok({
    ...diff,
    fromVersionId: fromVersion.id,
    toVersionId: toVersion.id,
    fromVersionNo: fromVersion.versionNo,
    toVersionNo: toVersion.versionNo,
  });
}
