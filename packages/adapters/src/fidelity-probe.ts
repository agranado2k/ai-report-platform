// ReportHtmlFidelityProbe — the FidelityProbe port (ADR-0090), backed by the
// editor's own code.
//
// The twin of `ReportHtmlEditabilityProbe`, and it exists for the same reason:
// the application layer must be able to ask "would the editor KEEP these
// bytes?" without importing ProseMirror/linkedom (ADR-024). It answers by
// delegating to `arp-report-html`'s `probeFidelity`, which round-trips the body
// through `parseBody` and `serializeBody` — the editor's own functions — and
// compares through a normaliser. There is deliberately no second predicate
// here: a hand-written list of "risky" tags would drift from the schema the
// first time it changed, which is the bug class both ADRs close.
//
// It never rejects an upload. A lossy document still views perfectly and is
// still fully editable; recording the verdict only makes the cost knowable
// before someone pays it.

import type { FidelityProbe, FidelityVerdict } from "arp-application";
import { probeFidelity } from "arp-report-html";

export class ReportHtmlFidelityProbe implements FidelityProbe {
  probe(entryDocument: Uint8Array, hasSourceDoc: boolean): FidelityVerdict | null {
    // UTF-8 with `fatal: false` (the default): malformed bytes become U+FFFD
    // rather than throwing, so the probe stays total. The stored bytes are
    // untouched either way — this decode is local to answering the question.
    const html = new TextDecoder().decode(entryDocument);
    return probeFidelity(html, hasSourceDoc);
  }
}
