// What would a save actually cost? — the owner view's Edit confirm dialog
// (ADR-0090, ticket #364).
//
// ADR-0090 persists the VERDICT and nothing else: `report_versions.fidelity`
// is `lossless | lossy | null`, and the `lostElements` / `lostAttributes` the
// probe collected at upload time are returned by the port and then dropped.
// That was a deliberate choice — §6 records only the fact, so the consumers
// could be built afterwards against something already reviewable — and it
// leaves this ticket one question to answer: how does a confirm dialog that
// must NAME what it would lose get those names?
//
// THE CHOICE (amending ADR-0090's implementation notes, not its decision):
// re-probe at request time, through the editor's own `probeFidelity`, reading
// the entry document the same way `../edit/load-document.ts` does. The three
// alternatives and why not:
//
//   - PERSIST the lists (two JSONB columns). A migration plus a backfill that
//     cannot run, for data that is already derivable in milliseconds from
//     bytes we hold. It would also freeze the names against the schema of the
//     day they were written, so PR #368's `<section class>` fix would leave
//     stale lists behind — the exact staleness ADR-0090 §1 built the
//     CALL-the-editor rule to avoid.
//   - FETCH them from the app-origin API when the dialog opens. ADR-0089 §6 is
//     explicit that the owner view makes no cross-origin call and carries no
//     capability in its payload; adding a data plane for a tooltip would
//     reopen that argument for the smallest possible prize.
//   - RE-PROBE on every render. Rejected on cost: a parse plus a serialise on
//     the common path, to answer a question whose answer is "nothing" for
//     almost every report.
//
// So the RECORDED verdict is the gate and the FRESH probe is the detail. One
// rule, stated once: a version recorded `lossy` always asks for confirmation;
// the re-probe only supplies the names to put in the sentence. Everything that
// can go wrong on the way to those names — an unreadable blob, an absent
// object, a probe that returns UNKNOWN, a fresh round trip that now comes back
// clean — yields a warning with EMPTY lists rather than no warning at all.
// Withholding the dialog because a read failed would convert an infrastructure
// hiccup into a silent lossy save, which is the one outcome this ticket exists
// to prevent. The dialog is written to say something true when the lists are
// empty.
//
// Total by contract, for the same reason `probeFidelity` is: this runs on a
// read path that must not gain a new crash site.
import type { BlobStore } from "arp-application";
import type { ReportId, VersionFidelity, VersionId } from "arp-domain";
import { probeFidelity } from "arp-report-html";

/** What an editor save would drop, as element and attribute NAMES — the shape
 *  a sentence can hold (ADR-0090 §1). Both lists may be empty: that means the
 *  verdict stands but the names could not be recovered, never that the save is
 *  free. */
export interface LossyWarning {
  readonly lostElements: readonly string[];
  readonly lostAttributes: readonly string[];
}

export interface LoadLossyWarningArgs {
  readonly blobs: BlobStore;
  readonly reportId: ReportId;
  readonly versionId: VersionId;
  readonly entryDocument: string;
  /** The version's RECORDED verdict. The gate: nothing is read or parsed
   *  unless this is `lossy`. */
  readonly fidelity: VersionFidelity | null;
  /** Carried only so a failed read keys its log line on the same field every
   *  other view-origin event does. */
  readonly slug: string;
  /** Structured-log sink; defaults to `console.warn` (the view origin has no
   *  logger of its own, ADR-0038). */
  readonly warn?: (line: string) => void;
}

const UNNAMED: LossyWarning = { lostElements: [], lostAttributes: [] };

export async function loadLossyWarning(args: LoadLossyWarningArgs): Promise<LossyWarning | null> {
  const { blobs, reportId, versionId, entryDocument, fidelity, slug } = args;
  const warn = args.warn ?? console.warn;

  // The gate. `lossless` and UNKNOWN both mean "do not ask" — and UNKNOWN in
  // particular must never be read as lossy (ADR-0090 §4).
  if (fidelity !== "lossy") return null;

  try {
    const blob = await blobs.readObject(reportId, versionId, entryDocument);
    if (!blob.ok || !blob.value) {
      warn(JSON.stringify({ event: "owner-view-lossy-items-unreadable", slug, versionId }));
      return UNNAMED;
    }

    // `hasSourceDoc: false` on purpose. A version carrying a `_source.json`
    // sidecar is `lossless` BY CONSTRUCTION (ADR-0090 §2), so it can never
    // reach this line; passing `true` here would short-circuit the round trip
    // and hand the dialog an empty list for every document it is asked about.
    const verdict = probeFidelity(new TextDecoder().decode(blob.value.bytes), false);

    // `null` (UNKNOWN) or a fresh `lossless` both leave us with a standing
    // recorded verdict and no names — see the one rule at the top of the file.
    if (verdict === null || verdict.fidelity !== "lossy") return UNNAMED;

    return { lostElements: verdict.lostElements, lostAttributes: verdict.lostAttributes };
  } catch {
    warn(JSON.stringify({ event: "owner-view-lossy-items-failed", slug, versionId }));
    return UNNAMED;
  }
}
