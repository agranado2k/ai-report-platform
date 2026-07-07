// Report — the aggregate root for hosted content (ADR-0036). All behaviour is
// pure: each operation returns a new Report plus the domain events it emitted.
// No I/O (ADR-024); persistence lives in adapters (ADR-020).

import { type Acl, DEFAULT_ACL } from "./acl";
import type { FolderId, OrgId, ReportId, UserId, VersionId } from "./brand";
import type { AppError } from "./errors";
import { notFound, validationError } from "./errors";
import type { DomainEvent, ReportPublished, ReportVersionUploaded } from "./events";
import type { ReportVersion, VersionManifest } from "./report-version";
import type { Result } from "./result";
import { err, ok } from "./result";
import type { Slug } from "./slug";
import type { TerminalScanStatus, VersionOrigin } from "./value-objects";

export interface Report {
  readonly id: ReportId;
  readonly orgId: OrgId;
  /** The user who created the report — its owner, in every org type (ADR-0059).
   *  Writes are owner-gated (via the canWrite seam); org_id stays the
   *  tenancy / quota / listing scope. */
  readonly ownerId: UserId;
  readonly folderId: FolderId;
  readonly slug: Slug;
  readonly title: string;
  readonly liveVersionId: VersionId | null;
  readonly versions: readonly ReportVersion[];
  readonly deletedAt: number | null;
  /** Sharing configuration (ADR-0056). Defaults to `private` (`DEFAULT_ACL`,
   *  owner-only; PR #127) — only loaded on single-report reads (not in list
   *  summaries). */
  readonly acl: Acl;
}

/** A state transition's result: the new aggregate state + the events it raised. */
export interface Emission {
  readonly report: Report;
  readonly events: readonly DomainEvent[];
}

export interface CreateReportParams {
  readonly id: ReportId;
  readonly orgId: OrgId;
  readonly folderId: FolderId;
  readonly slug: Slug;
  readonly title: string;
  readonly versionId: VersionId;
  readonly contentHash: string;
  readonly uploadedBy: UserId;
  readonly manifest: VersionManifest;
  readonly sizeBytes: number;
  /** How this version was produced (ADR-0065). Defaults to `upload` — every call
   *  site today is a plain upload; the editor (ADR-0062) will pass `editor`. */
  readonly origin?: VersionOrigin;
}

/** Create a new Report with its first ReportVersion (version 1, pending scan). */
export function createReport(p: CreateReportParams): Emission {
  const firstVersion: ReportVersion = {
    id: p.versionId,
    versionNo: 1,
    contentHash: p.contentHash,
    uploadedBy: p.uploadedBy,
    scanStatus: "pending",
    manifest: p.manifest,
    sizeBytes: p.sizeBytes,
    origin: p.origin ?? "upload",
  };
  const report: Report = {
    id: p.id,
    orgId: p.orgId,
    ownerId: p.uploadedBy, // the creator is the owner (ADR-0059)
    folderId: p.folderId,
    slug: p.slug,
    title: p.title,
    liveVersionId: null,
    versions: [firstVersion],
    deletedAt: null,
    acl: DEFAULT_ACL, // new reports are private until set_acl shares them (ADR-0056)
  };
  const event: ReportVersionUploaded = {
    type: "ReportVersionUploaded",
    reportId: p.id,
    versionId: p.versionId,
    versionNo: 1,
  };
  return { report, events: [event] };
}

export interface AddVersionParams {
  readonly versionId: VersionId;
  readonly contentHash: string;
  readonly uploadedBy: UserId;
  readonly manifest: VersionManifest;
  readonly sizeBytes: number;
  /** How this version was produced (ADR-0065). Defaults to `upload`. */
  readonly origin?: VersionOrigin;
}

/**
 * Re-upload: append a new ReportVersion (version_no = max+1, pending scan).
 * Content-only — does not touch the live version, title, folder, or ACL
 * (ADR-0037 §2). A taken-down report rejects re-upload.
 */
export function addVersion(report: Report, p: AddVersionParams): Result<Emission, AppError> {
  if (report.deletedAt !== null) return err(notFound("report has been taken down"));

  const nextNo = Math.max(...report.versions.map((v) => v.versionNo)) + 1;
  const version: ReportVersion = {
    id: p.versionId,
    versionNo: nextNo,
    contentHash: p.contentHash,
    uploadedBy: p.uploadedBy,
    scanStatus: "pending",
    manifest: p.manifest,
    sizeBytes: p.sizeBytes,
    origin: p.origin ?? "upload",
  };
  const updated: Report = { ...report, versions: [...report.versions, version] };
  const event: ReportVersionUploaded = {
    type: "ReportVersionUploaded",
    reportId: report.id,
    versionId: p.versionId,
    versionNo: nextNo,
  };
  return ok({ report: updated, events: [event] });
}

/**
 * Apply a scan verdict (handling a consumed ReportVersionScanned). Updates the
 * version's cached scan_status. On a `clean` verdict, promotes it to live
 * **only if** it is newer than the current live version (monotonic
 * promote-if-newer, ADR-0037 §8) and emits ReportPublished. `flagged`/`blocked`
 * never promote; an out-of-order clean for an older version never demotes.
 *
 * `verdict` is a `TerminalScanStatus` — `pending` is not a scan *result*. An
 * unknown `scannedId` (a stale or duplicate scan event for a version this
 * aggregate no longer holds) is **silently absorbed**: the aggregate is
 * returned unchanged with no events. This idempotent no-op is intentional.
 */
export function applyScanResult(
  report: Report,
  scannedId: VersionId,
  verdict: TerminalScanStatus,
): Emission {
  const versions = report.versions.map((v) =>
    v.id === scannedId ? { ...v, scanStatus: verdict } : v,
  );

  const scanned = report.versions.find((v) => v.id === scannedId);
  if (verdict !== "clean" || scanned === undefined) {
    return { report: { ...report, versions }, events: [] };
  }

  const liveNo =
    report.liveVersionId === null
      ? null
      : (report.versions.find((v) => v.id === report.liveVersionId)?.versionNo ?? null);

  if (liveNo !== null && scanned.versionNo <= liveNo) {
    return { report: { ...report, versions }, events: [] };
  }

  const published: ReportPublished = {
    type: "ReportPublished",
    reportId: report.id,
    versionId: scannedId,
    firstPublish: report.liveVersionId === null,
  };
  return {
    report: { ...report, versions, liveVersionId: scannedId },
    events: [published],
  };
}

/**
 * Move the report into a different Folder. Pure transition — the use case
 * validates that the target Folder belongs to the report's Org (ADR-0036).
 */
export function placeInFolder(report: Report, folderId: FolderId): Report {
  return { ...report, folderId };
}

const MAX_TITLE = 200;

/** Rename the report (its display title). Pure transition; the slug is permanent
 * and unaffected (ADR-0038). The use case validates org ownership. */
export function renameReport(report: Report, title: string): Result<Report, AppError> {
  const trimmed = title.trim();
  if (trimmed.length === 0) return err(validationError("report title is required", "title"));
  if (trimmed.length > MAX_TITLE) {
    return err(validationError(`report title too long (max ${MAX_TITLE})`, "title"));
  }
  return ok({ ...report, title: trimmed });
}
