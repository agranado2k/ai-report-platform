// ReportVersion — a single content snapshot of a Report. Part of the Report
// aggregate; never mutated in place (functional/immutable, ADR-024).

import type { UserId, VersionId } from "./brand";
import type { ScanStatus, VersionOrigin } from "./value-objects";

// Describes a version's served content: the entry document plus the relative
// paths of every file in the bundle. Persisted as report_versions.manifest_json
// (db-design.md); produced by bundle processing (the ProcessedBundle).
export interface VersionManifest {
  readonly entryDocument: string;
  readonly files: readonly string[];
}

export interface ReportVersion {
  readonly id: VersionId;
  readonly versionNo: number;
  readonly contentHash: string;
  readonly uploadedBy: UserId;
  readonly scanStatus: ScanStatus;
  readonly manifest: VersionManifest;
  readonly sizeBytes: number;
  /** How this version was produced (ADR-0062 §6 / ADR-0065). Today every version is
   *  `upload` — the editor doesn't exist yet. */
  readonly origin: VersionOrigin;
}
