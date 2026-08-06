// ReportHtmlEditabilityProbe — the EditabilityProbe port (ADR-0080), backed by
// the editor's own code.
//
// This adapter exists so the application layer can ask "could the editor open
// these bytes?" without importing ProseMirror/linkedom (ADR-024). It answers by
// delegating to `arp-report-html`'s `probeEditability`, which in turn CALLS
// `splitShell` and `parseBody` — the same two functions the /edit loader calls.
// There is deliberately no second predicate anywhere in this file: a
// re-derivation ("does it contain `<body`?") would drift from the real
// precondition the first time either function changed, which is the bug class
// ADR-0080 closes.
//
// It never rejects an upload. "Views fine, won't edit" is a legitimate state
// (uploads are stored verbatim and the viewer streams them, ADR-0038); this
// only makes that state knowable at write time.

import type { EditabilityProbe } from "arp-application";
import type { VersionEditability } from "arp-domain";
import { probeEditability } from "arp-report-html";

export class ReportHtmlEditabilityProbe implements EditabilityProbe {
  probe(entryDocument: Uint8Array, hasSourceDoc: boolean): VersionEditability {
    // UTF-8 with `fatal: false` (the default): malformed bytes become U+FFFD
    // rather than throwing, so the probe stays total. The stored bytes are
    // untouched either way — this decode is local to answering the question.
    const html = new TextDecoder().decode(entryDocument);
    return probeEditability(html, hasSourceDoc);
  }
}
