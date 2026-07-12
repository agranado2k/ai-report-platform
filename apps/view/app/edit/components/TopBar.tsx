// The unified experience's app-styled chrome (edit-chrome-cleanup): brand ·
// doc title · save-status · Save. On /edit the user is ALWAYS editing, so the
// old View⇄Edit segmented toggle and the Comments/Versions tab buttons are
// gone — Comments/Versions now live behind a collapsed-by-default side panel
// (its own in-panel tab switcher; see PanelChrome + the route component). The
// bar stays a thin strip so the document dominates. The single exception to
// "always editing" is Compare (visual diff), entered from the Versions panel:
// there the bar shows just a "← Back to document" button.
import { Button } from "arp-ui";

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
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-6 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <p className="shrink-0 text-xs font-medium uppercase tracking-wide text-subtle">
          Centaur Spec
        </p>
        <h1 className="truncate text-sm font-semibold text-fg">{docTitle}</h1>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {mode === "diff" ? (
          <Button variant="secondary" size="sm" onClick={onCloseCompare}>
            ← Back to document
          </Button>
        ) : null}

        <span className="text-xs text-subtle" role="status" aria-live="polite">
          {saveStatus}
        </span>
        <Button variant="primary" size="sm" onClick={onSave} disabled={saveDisabled}>
          Save
        </Button>
      </div>
    </header>
  );
}
