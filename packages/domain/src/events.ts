// Domain events at the Report aggregate boundary (ADR-0036). Names are the
// contract (docs/events.md). ReportVersionUploaded + ReportPublished are
// emitted by Reports & Folders; ReportVersionScanned is emitted by Abuse &
// Moderation and consumed here (applyScanResult) to update the scan cache and
// drive promotion.

import type { ReportId, VersionId } from "./brand";
import type { TerminalScanStatus, VersionOrigin } from "./value-objects";

export interface ReportVersionUploaded {
  readonly type: "ReportVersionUploaded";
  readonly reportId: ReportId;
  readonly versionId: VersionId;
  readonly versionNo: number;
  /** ADR-0062 §6 — audit/analytics only, no consumer behavior change. */
  readonly origin: VersionOrigin;
}

export interface ReportVersionScanned {
  readonly type: "ReportVersionScanned";
  readonly reportId: ReportId;
  readonly versionId: VersionId;
  readonly verdict: TerminalScanStatus;
}

export interface ReportPublished {
  readonly type: "ReportPublished";
  readonly reportId: ReportId;
  readonly versionId: VersionId;
  readonly firstPublish: boolean;
}

export type DomainEvent = ReportVersionUploaded | ReportVersionScanned | ReportPublished;
