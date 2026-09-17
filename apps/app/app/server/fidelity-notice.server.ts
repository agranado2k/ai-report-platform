// The dashboard's hint for a report the editor would not KEEP (ADR-0090).
//
// The twin of `editability-notice.server.ts`, deliberately kept as a separate
// function rather than folded into it: the two verdicts are orthogonal
// (ADR-0090's whole premise), and `editable` + `lossy` is the combination that
// matters. A single function switching over both would have to answer two
// questions in one sentence — which is the fourth-enum-value mistake the ADR
// rejected, relocated into the presentation layer.
//
// Same doctrine as its twin: the server ships a CONCLUSION, the component
// renders it. And the same posture — this is an EXPLANATION, never a gate. The
// row still links to `/open`, the editor still opens the report, and a save is
// still allowed. Nothing here suppresses an affordance, because a stale or
// wrong verdict must never lock an author out of their own report
// (ADR-0090 §5).

import type { VersionFidelity } from "arp-domain";

export interface FidelityNotice {
  readonly label: string;
  /** The `title` attribute — the full explanation, including what to do. */
  readonly title: string;
}

/**
 * The hint to show beside a report row, or `null` when there is nothing to say.
 *
 * `lossless` says nothing because there is no cost to warn about, and `null`
 * (UNKNOWN) says nothing because every ReportVersion written before ADR-0090
 * reads UNKNOWN — announcing it would fire on the entire existing corpus at
 * once, which is noise, not a finding.
 */
export function fidelityNotice(fidelity: VersionFidelity | null): FidelityNotice | null {
  if (fidelity !== "lossy") return null;

  return {
    // Not "Not editable" — that is the OTHER verdict's label, and this report
    // opens in the editor perfectly well. What it cannot survive is a save.
    label: "View-only",
    title:
      "This report still views exactly as published, and the editor can open it — but " +
      "saving it from the editor would drop content the editor doesn't keep, such as inline " +
      "scripts, inline SVG, or attributes outside its schema. Treat it as view-only: to " +
      "change it, re-upload the full HTML rather than editing and saving here.",
  };
}
