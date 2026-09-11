// The unified experience's app-styled chrome (edit-chrome-cleanup): brand ·
// doc title · save-status · Save. On /edit the user is ALWAYS editing, so the
// old View⇄Edit segmented toggle and the Comments/Versions tab buttons are
// gone — Comments/Versions now live behind a collapsed-by-default side panel
// (its own in-panel tab switcher; see PanelChrome + the route component). The
// bar stays a thin strip so the document dominates. The single exception to
// "always editing" is Compare (visual diff), entered from the Versions panel:
// there the bar shows just a "← Back to document" button.
//
// The strip itself — brand mark, title over the product label, the pill slot,
// the action group — is `ChromeBar` (arp-ui), shared with the owner view's bar
// (ADR-0089) so the two surfaces cannot drift apart visually. What stays here
// is only what is specific to editing: the save status and the Save button.
import { Button, ChromeBar, chromeBarPillClass } from "arp-ui";

// Only two live states on /edit: always-editing, or Compare (visual diff).
// View mode was removed with its toggle — keep the union at exactly the two
// reachable states so a future edit can't silently re-introduce a dead branch.
export type ViewerMode = "edit" | "diff";

export interface TopBarProps {
  readonly docTitle: string;
  readonly mode: ViewerMode;
  readonly onCloseCompare: () => void;
  readonly saveStatus: string;
  readonly saveDisabled: boolean;
  readonly onSave: () => void;
}

export function TopBar({
  docTitle,
  mode,
  onCloseCompare,
  saveStatus,
  saveDisabled,
  onSave,
}: TopBarProps) {
  return (
    <ChromeBar
      docTitle={docTitle}
      pill={
        // Save status as a pill (empty until the first save/error). The
        // element is ALWAYS present so `role="status"` stays a stable live
        // region; it only wears the pill fill when it carries a message.
        <span role="status" aria-live="polite" className={chromeBarPillClass(Boolean(saveStatus))}>
          {saveStatus}
        </span>
      }
    >
      {mode === "diff" ? (
        <Button variant="secondary" size="sm" onClick={onCloseCompare}>
          ← Back to document
        </Button>
      ) : null}

      <Button variant="primary" size="sm" onClick={onSave} disabled={saveDisabled}>
        Save
      </Button>
    </ChromeBar>
  );
}
