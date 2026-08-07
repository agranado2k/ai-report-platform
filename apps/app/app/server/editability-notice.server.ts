// The dashboard's explanation for an un-editable report (ADR-0080).
//
// The Edit affordance on a report row is the stretched link to
// `/reports/{slug}/open`. When the live version's bytes cannot be opened, that
// link ends in a redirect back to the read-only viewer — which, before this,
// was the FIRST and only thing the user learned. This turns the recorded
// verdict into a sentence, server-side, following the `reportSharingBadge` /
// `folderManagement` doctrine: the server ships conclusions, the component
// renders them.
//
// It is an EXPLANATION, never a gate. The row still links to `/open` — the
// editor is still allowed to try, and PR #247's degrade still catches it. A
// recorded verdict that suppressed the affordance would turn advisory metadata
// into authorization, and a stale or wrong verdict would then lock a user out
// of a report they can actually edit.

import type { VersionEditability } from "arp-domain";

export interface EditabilityNotice {
  readonly label: string;
  /** The `title` attribute — the full explanation, including what to do. */
  readonly title: string;
}

/**
 * The notice to show beside a report row, or `null` when there is nothing to
 * say.
 *
 * `null` (UNKNOWN) is deliberately silent: every version written before
 * ADR-0080 reads UNKNOWN, and announcing "we don't know" on the whole existing
 * corpus would be noise indistinguishable from a real problem.
 */
export function editabilityNotice(
  editability: VersionEditability | null,
): EditabilityNotice | null {
  switch (editability) {
    case "unsplittable":
      return {
        label: "Not editable",
        title:
          "This report still views normally, but the editor can't open it: its <body> tag is " +
          "malformed — unclosed, or closed before it opens. Re-upload it with a balanced " +
          "<body>…</body>, or with no <body> tag at all, and it will open.",
      };
    case "unparsable":
      return {
        label: "Not editable",
        title:
          "This report still views normally, but the editor can't open it: its body defeated " +
          "the editor's parser (usually very deeply nested markup). Re-upload a simpler " +
          "document structure to make it editable.",
      };
    default:
      // `editable` and UNKNOWN both say nothing.
      return null;
  }
}
