// ReportVersion — a single content snapshot of a Report. Part of the Report
// aggregate; never mutated in place (functional/immutable, ADR-024).

import type { UserId, VersionId } from "./brand";
import type { ScanStatus } from "./value-objects";

export interface ReportVersion {
  readonly id: VersionId;
  readonly versionNo: number;
  readonly contentHash: string;
  readonly uploadedBy: UserId;
  readonly scanStatus: ScanStatus;
}
