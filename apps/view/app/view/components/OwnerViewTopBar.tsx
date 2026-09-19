// The owner view's chrome strip (ADR-0089 §1). Wears the SAME `ChromeBar` the
// editor's TopBar wears (App Shell Mockups §06) — the surfaces are meant to
// feel like one product — and differs only in what it puts in the slots: the
// report's share state as the pill, and Versions / Edit as the actions.
//
// Everything here is a link, not a fetcher. The owner view has no cross-origin
// data plane and holds no token in its payload (ADR-0089 §6); giving this bar
// a client-side API call would mean re-opening that argument.
import { buttonClass, ChromeBar, chromeBarPillClass } from "arp-ui";
import type { LossyWarning } from "../lossy-warning";
import { LossyEditDialog } from "./LossyEditDialog";

export interface OwnerViewTopBarProps {
  /** The report's title. Author-controlled, so it is rendered as a text node
   *  by `ChromeBar` and never interpolated into markup or an attribute. */
  readonly docTitle: string;
  /** How the report is shared, already resolved to display copy by the
   *  loader — this component makes no policy decision of its own. */
  readonly shareState: string;
  /** Where "Open in new tab" goes: the canonical `/<slug>` as a TOP-LEVEL
   *  document (ADR-0092). Always offered — it is the reliable escape for a
   *  report that blanks in the storage-less sandboxed frame (ADR-0089 §2),
   *  since no cross-origin blank-detection is possible across the opaque
   *  origin. Opens with `target="_blank"` / `rel="noopener"`. */
  readonly openHref: string;
  /** Where "Versions" goes (the editor's Versions panel, on the app's mint). */
  readonly versionsHref: string;
  /** Where "Edit" goes. A plain navigation to `/<slug>/edit` — which, holding
   *  no capability under that Path, funnels through the app's one edit-token
   *  mint and gets `canWrite` re-checked live (ADR-0089 §4b). */
  readonly editHref: string;
  /** False on the owner-read degrade: the visitor proved ownership with a
   *  verified `oa` fallback but holds no edit capability, so the action that
   *  would fail is not offered. */
  readonly canEdit: boolean;
  /** What an editor save would drop (ADR-0090), or `null` when the live
   *  version is `lossless` or was never probed — which is almost always. Non-
   *  null turns Edit into a confirm step; the loader decided that, this bar
   *  only renders it. */
  readonly lossyWarning: LossyWarning | null;
}

export function OwnerViewTopBar({
  docTitle,
  shareState,
  openHref,
  versionsHref,
  editHref,
  canEdit,
  lossyWarning,
}: OwnerViewTopBarProps) {
  return (
    <ChromeBar
      docTitle={docTitle}
      pill={
        // Always the FILLED pill. `shareStateLabel` is total over `AclMode`'s
        // five modes and every one of its labels is a non-empty phrase, so this
        // pill always carries a message; the empty-slot case
        // `chromeBarPillClass(false)` exists for — the editor's save-status
        // pill, holding its slot while idle — cannot arise on this surface.
        // This read as `Boolean(shareState)`, which looked like a guard and was
        // a constant `true`: a branch no test could ever take, and one that
        // disguised the invariant as a runtime question.
        <span className={chromeBarPillClass(true)}>{shareState}</span>
      }
    >
      {/* The unconditional escape (ADR-0092, #385). A report that reads
          storage/cookie before first paint blanks in the owner view's
          storage-less sandboxed frame (ADR-0089 §2). This opens the CANONICAL
          `/<slug>` as a TOP-LEVEL document — a real origin where storage works,
          served directly by the hand-off's `Path=/<slug>` unlock cookie — in a
          new tab. Present for EVERY report, blank or not: the frame is opaque,
          so the chrome cannot read whether a given report errored, and a
          control gated on a fragile guess is worse than one always there.
          `rel="noopener"` denies the opened top-level page a handle back to the
          chrome; it is unobtrusive (secondary), sitting left of the
          capability-gated actions. */}
      <a href={openHref} target="_blank" rel="noopener" className={buttonClass("secondary", "sm")}>
        Open in new tab
      </a>

      {/* Anchors wearing the button look (`buttonClass`) rather than
          `<Button>`: both actions are plain navigations, and a real link is
          what makes them middle-clickable, focusable and screen-reader
          correct.

          BOTH are gated on `canEdit`, not just Edit. Versions is a deep-link
          into the editor's own side panel, so it lands on `/<slug>/edit` —
          which, holding no capability under that Path, funnels through the
          app's one mint and re-checks `canWrite` live (ADR-0089 §4b). For a
          holder on the owner-read degrade that round-trip ends where it
          started, so offering the action is offering a dead end. The degrade
          keeps what it can honour: the report, its title and its share
          state. */}
      {canEdit ? (
        <>
          <a href={versionsHref} className={buttonClass("secondary", "sm")}>
            Versions
          </a>
          {/* ADR-0090 / #364. On a LOSSY live version Edit gains a confirm
              step that names what a save would drop; on `lossless` or UNKNOWN
              — almost every report — it stays the plain anchor it has always
              been, with no dialog markup and no JS. Both render the same
              `editHref`, because the confirm INTERCEPTS the navigation rather
              than replacing it. */}
          {lossyWarning ? (
            <LossyEditDialog editHref={editHref} warning={lossyWarning} />
          ) : (
            <a href={editHref} className={buttonClass("primary", "sm")}>
              Edit
            </a>
          )}
        </>
      ) : null}
    </ChromeBar>
  );
}
