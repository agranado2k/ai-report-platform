// The unified experience's app-styled chrome (unified-experience epic): brand
// · doc title · a View ⇄ Edit toggle (replaced by "← Back to document" while
// comparing) · Comments/Versions tab buttons · Save. The document itself
// stays the dominant element — this bar is a thin strip, and the left panel
// it opens is HIDDEN by default (see the route component).
import { Button, cx } from "arp-ui";
import type { PanelTab } from "./types";

export type ViewerMode = "edit" | "view" | "diff";

export interface TopBarProps {
  readonly docTitle: string;
  readonly mode: ViewerMode;
  readonly onSelectMode: (mode: "edit" | "view") => void;
  readonly onCloseCompare: () => void;
  readonly activeTab: PanelTab;
  readonly onToggleTab: (tab: "comments" | "versions") => void;
  readonly commentCount: number;
  readonly saveStatus: string;
  readonly saveDisabled: boolean;
  readonly onSave: () => void;
}

function TabButton({
  label,
  active,
  onClick,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  return (
    <Button variant={active ? "primary" : "secondary"} size="sm" onClick={onClick}>
      {label}
    </Button>
  );
}

export function TopBar({
  docTitle,
  mode,
  onSelectMode,
  onCloseCompare,
  activeTab,
  onToggleTab,
  commentCount,
  saveStatus,
  saveDisabled,
  onSave,
}: TopBarProps) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <p className="shrink-0 text-xs font-medium uppercase tracking-wide text-subtle">
          Centaur Spec
        </p>
        <h1 className="truncate text-sm font-semibold text-fg">{docTitle}</h1>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {mode === "diff" ? (
          <Button variant="secondary" size="sm" onClick={onCloseCompare}>
            ← Back to document
          </Button>
        ) : (
          <div className="flex overflow-hidden rounded-control border border-border">
            <button
              type="button"
              onClick={() => onSelectMode("edit")}
              className={cx(
                "px-3 py-1 text-xs font-medium transition-colors",
                mode === "edit" ? "bg-brand text-on-brand" : "bg-surface text-muted hover:text-fg",
              )}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => onSelectMode("view")}
              className={cx(
                "px-3 py-1 text-xs font-medium transition-colors",
                mode === "view" ? "bg-brand text-on-brand" : "bg-surface text-muted hover:text-fg",
              )}
            >
              View
            </button>
          </div>
        )}

        <TabButton
          label={`Comments${commentCount ? ` (${commentCount})` : ""}`}
          active={activeTab === "comments"}
          onClick={() => onToggleTab("comments")}
        />
        <TabButton
          label="Versions"
          active={activeTab === "versions"}
          onClick={() => onToggleTab("versions")}
        />

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
