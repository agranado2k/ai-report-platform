// The owner view's chrome strip (ADR-0089 §1). Wears the SAME `ChromeBar` the
// editor's TopBar wears (App Shell Mockups §06) — the surfaces are meant to
// feel like one product — and differs only in what it puts in the slots: the
// report's share state as the pill, and Versions / Edit as the actions.
//
// Everything here is a link, not a fetcher. The owner view has no cross-origin
// data plane and holds no token in its payload (ADR-0089 §6); giving this bar
// a client-side API call would mean re-opening that argument.
import { buttonClass, ChromeBar, chromeBarPillClass } from "arp-ui";

export interface OwnerViewTopBarProps {
  /** The report's title. Author-controlled, so it is rendered as a text node
   *  by `ChromeBar` and never interpolated into markup or an attribute. */
  readonly docTitle: string;
  /** How the report is shared, already resolved to display copy by the
   *  loader — this component makes no policy decision of its own. */
  readonly shareState: string;
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
}

export function OwnerViewTopBar({
  docTitle,
  shareState,
  versionsHref,
  editHref,
  canEdit,
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
          <a href={editHref} className={buttonClass("primary", "sm")}>
            Edit
          </a>
        </>
      ) : null}
    </ChromeBar>
  );
}
