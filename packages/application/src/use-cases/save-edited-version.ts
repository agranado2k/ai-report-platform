// SaveEditedVersionUseCase — the editor-save entry point (ADR-0062 §5). Edit-save
// IS an upload: this is a thin, intent-named wrapper over uploadReport, not a
// second pipeline. The whole re-assembled document (presentation shell +
// edited body, via arp-report-html's reinjectShell — a UI/adapter-layer
// concern kept OUT of this package, ADR-024) runs through the exact same
// R2-first/commit-last/idempotent/scan-enqueue pipeline as a plain re-upload.
// The only differences from a plain re-upload: `origin: 'editor'` (ADR-0065's
// origin attribute) and the lossless `_source.json` sidecar (ADR-0062 §4).
//
// Edit-save always targets an EXISTING report (an editor session always opens
// a live version first) — there is no create path here, so `uploadReport` is
// always driven via `updateSlug`, which reuses its `canWrite` authorization
// (ADR-0059 §2 / ADR-0060-ready) verbatim: a non-owner's save fails exactly
// like a non-owner's re-upload (NotAllowed, 403).
import type { AppError, Result } from "arp-domain";
import type { UploadActor, UploadOutcome, UploadReportDeps } from "./upload-report";
import { uploadReport } from "./upload-report";

export interface SaveEditedVersionCommand {
  readonly actor: UploadActor;
  /** The report being edited, by its existing slug. */
  readonly slug: string;
  /** The whole HTML document — presentation shell + edited body, already
   *  reassembled (reinjectShell) by the caller. */
  readonly html: Uint8Array;
  /**
   * The ProseMirror document JSON — the lossless `_source.json` sidecar
   * (ADR-0062 §4). Opaque `Record<string, unknown>` here, not a report-html
   * `PMDocJson` import — this package stays free of the ProseMirror
   * dependency (ADR-024); it's just bytes to `uploadReport` from here.
   */
  readonly sourceDoc: Record<string, unknown>;
  /**
   * Idempotency (ADR-0039). Undefined falls back to uploadReport's derived
   * key — hash(user ∥ route ∥ content_hash ∥ target) — UNCHANGED: because
   * this wrapper calls the SAME uploadReport function, the derived key's
   * `route` segment is still the upload route's own constant. This is a
   * deliberate reuse, not an oversight: two saves of byte-identical content
   * to the same slug dedupe exactly like two identical re-uploads would —
   * which is the correct behavior for a double-submitted Save click. If
   * editor-saves and API uploads to the same slug ever need independent
   * idempotency namespaces, thread a distinct route/target segment through
   * uploadReport instead of sharing its private ROUTE constant.
   */
  readonly idempotencyKey?: string;
}

export async function saveEditedVersion(
  deps: UploadReportDeps,
  cmd: SaveEditedVersionCommand,
): Promise<Result<UploadOutcome, AppError>> {
  return uploadReport(deps, {
    actor: cmd.actor,
    upload: { filename: "index.html", bytes: cmd.html },
    updateSlug: cmd.slug,
    origin: "editor",
    sourceDoc: cmd.sourceDoc,
    idempotencyKey: cmd.idempotencyKey,
  });
}
