// processScanResult — apply a scan verdict to a report version and, on `clean`,
// promote it to live (ADR-0037 §8 monotonic promote-if-newer). Pure orchestration
// over the driven ports (ADR-0024); the domain `applyScanResult` holds the rules.
//
// Phase 1: the always-clean scan stub invokes this synchronously right after a
// successful upload (verdict `clean`). Phase 1.5: the real scanner worker invokes
// it with the actual verdict when a `ReportVersionScanned` event is consumed.
// Either way the body is identical — the verdict is the only input that changes.

import {
  type AppError,
  applyScanResult,
  err,
  notFound,
  ok,
  type ReportId,
  type Result,
  type TerminalScanStatus,
  type VersionId,
} from "arp-domain";
import type { EventOutbox, ReportRepository, ScanQueue, UnitOfWork } from "../ports";

export interface ProcessScanResultDeps {
  readonly reports: ReportRepository;
  readonly scans: ScanQueue;
  readonly outbox: EventOutbox;
  readonly uow: UnitOfWork;
}

export interface ProcessScanCommand {
  readonly reportId: ReportId;
  readonly versionId: VersionId;
  readonly verdict: TerminalScanStatus;
}

export interface ProcessScanOutcome {
  readonly scanStatus: TerminalScanStatus;
  /** true → this verdict promoted the version to live (a ReportPublished was emitted). */
  readonly promoted: boolean;
}

export async function processScanResult(
  deps: ProcessScanResultDeps,
  cmd: ProcessScanCommand,
): Promise<Result<ProcessScanOutcome, AppError>> {
  const found = await deps.reports.findById(cmd.reportId);
  if (!found.ok) return found;
  if (!found.value) return err(notFound("report not found"));

  // Domain rule: caches scan_status, promotes-if-newer on clean, emits events.
  const { report, events } = applyScanResult(found.value, cmd.versionId, cmd.verdict);

  // Atomic: persist the promotion + outbox the events + mark the job done
  // together (ADR-0037 §5), so the cached scan_status / live_version_id and the
  // scan_jobs row never diverge.
  const committed = await deps.uow.run(async () => {
    const saved = await deps.reports.save(report);
    if (!saved.ok) return saved;
    const enq = await deps.outbox.enqueue(events);
    if (!enq.ok) return enq;
    return deps.scans.completeScan(cmd.versionId, cmd.verdict);
  });
  if (!committed.ok) return committed;

  return ok({
    scanStatus: cmd.verdict,
    promoted: events.some((e) => e.type === "ReportPublished"),
  });
}
