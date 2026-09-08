// The unified experience's app-styled chrome (edit-chrome-cleanup): brand ·
// doc title · save-status · Save. On /edit the user is ALWAYS editing, so the
// old View⇄Edit segmented toggle and the Comments/Versions tab buttons are
// gone — Comments/Versions now live behind a collapsed-by-default side panel
// (its own in-panel tab switcher; see PanelChrome + the route component). The
// bar stays a thin strip so the document dominates. The single exception to
// "always editing" is Compare (visual diff), entered from the Versions panel:
// there the bar shows just a "← Back to document" button.
import { Button, cx } from "arp-ui";

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
    // `print:hidden` (comment-UX adoptions, item E): printing the /edit route
    // keeps only the document (with its highlight marks) — never the chrome.
    // T8 (§06) reworks the bar into a thin 2026-grade strip: a brand mark, the
    // document title over a small product label, and a save-status pill — the
    // document below it dominates.
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-6 py-3 print:hidden">
      <div className="flex min-w-0 items-center gap-3">
        {/* The brand mark — a rounded brand-fill square with the Centaur
            monogram. Decorative (the product name sits beside it as text), so
            aria-hidden; a plain letterform keeps it CSP-safe with no icon dep. */}
        <span
          aria-hidden="true"
          className="grid size-7 shrink-0 place-items-center rounded-control bg-brand text-sm font-bold text-on-brand"
        >
          C
        </span>
        <div className="flex min-w-0 flex-col leading-tight">
          <h1 className="truncate text-sm font-semibold text-fg">{docTitle}</h1>
          <span className="text-[10px] font-medium uppercase tracking-wide text-subtle">
            Centaur Spec
          </span>
        </div>

        {/* Save status as a pill (empty until the first save/error). The
            element is ALWAYS present so `role="status"` stays a stable live
            region; it only wears the pill fill when it carries a message. */}
        <span
          role="status"
          aria-live="polite"
          className={cx(
            "ml-1 inline-flex items-center text-xs text-subtle",
            saveStatus && "rounded-full bg-hover px-2.5 py-1 text-muted",
          )}
        >
          {saveStatus}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {mode === "diff" ? (
          <Button variant="secondary" size="sm" onClick={onCloseCompare}>
            ← Back to document
          </Button>
        ) : null}

        <Button variant="primary" size="sm" onClick={onSave} disabled={saveDisabled}>
          Save
        </Button>
      </div>
    </header>
  );
}
