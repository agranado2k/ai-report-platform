// Chrome for the collapsible Comments/Versions side panel (edit-chrome-cleanup).
// The View⇄Edit toggle and the top-bar Comments/Versions buttons are gone —
// on /edit the user is always editing, and the panel is a document-dominant,
// collapsed-by-default surface. Two pieces live here:
//
//   • PanelToggle — the collapsed-edge affordance pinned to the right of the
//     document. A `‹` chevron that opens the panel to Comments, badged with the
//     count of ACTIVE (unresolved) comment threads.
//   • PanelHeader — the open panel's own header: a Comments | Versions tab
//     switcher (the switch moved here now the top buttons are gone) plus a `›`
//     control that collapses the panel again.
//
// arp-ui ships no chevron in its icon set (packages/ui/src/icons.tsx) and this
// worktree may not touch packages/ui, so the two chevrons below are local
// inline SVGs following that file's Icon conventions (24×24, currentColor,
// aria-hidden — CSP-safe, no icon-library dep, ADR-0050).
import { Badge, Button, cx } from "arp-ui";
import type { ComponentProps } from "react";
import type { PanelTab } from "../panel";

type ChevronProps = ComponentProps<"svg">;

function Chevron({ d, ...props }: ChevronProps & { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={d} />
    </svg>
  );
}

/** `‹` — points left, "pull the panel out from the right edge". */
function ChevronLeftIcon(props: ChevronProps) {
  return <Chevron d="M15 6l-6 6 6 6" {...props} />;
}

/** `›` — points right, "push the panel back to the edge". */
function ChevronRightIcon(props: ChevronProps) {
  return <Chevron d="M9 6l6 6-6 6" {...props} />;
}

/** Collapsed-edge affordance shown when the panel is closed. Opens the panel to
 *  the Comments tab; surfaces the unresolved-thread count as a badge. */
export function PanelToggle({
  unresolvedCount,
  onOpen,
}: {
  readonly unresolvedCount: number;
  readonly onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={
        unresolvedCount > 0
          ? `Open comments and versions panel (${unresolvedCount} unresolved)`
          : "Open comments and versions panel"
      }
      className="flex shrink-0 items-center gap-1.5 self-start rounded-l-card border border-r-0 border-border bg-surface px-2 py-3 text-subtle transition-colors hover:text-fg"
    >
      <ChevronLeftIcon className="h-4 w-4" />
      {unresolvedCount > 0 ? (
        <Badge tone="brand" aria-hidden="true">
          {unresolvedCount}
        </Badge>
      ) : null}
    </button>
  );
}

function PanelTabButton({
  label,
  active,
  onClick,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "border-b-2 pb-1.5 text-sm font-medium transition-colors",
        active ? "border-brand text-fg" : "border-transparent text-subtle hover:text-fg",
      )}
    >
      {label}
    </button>
  );
}

/** The open panel's header: the Comments | Versions switcher + a hide control. */
export function PanelHeader({
  tab,
  unresolvedCount,
  onSelectTab,
  onClose,
}: {
  readonly tab: PanelTab;
  readonly unresolvedCount: number;
  readonly onSelectTab: (tab: PanelTab) => void;
  readonly onClose: () => void;
}) {
  return (
    <div className="mb-4 flex items-center justify-between border-b border-border pb-2">
      <div className="flex items-center gap-4">
        <PanelTabButton
          label={`Comments${unresolvedCount ? ` (${unresolvedCount})` : ""}`}
          active={tab === "comments"}
          onClick={() => onSelectTab("comments")}
        />
        <PanelTabButton
          label="Versions"
          active={tab === "versions"}
          onClick={() => onSelectTab("versions")}
        />
      </div>
      <Button variant="ghost" size="sm" onClick={onClose} aria-label="Hide panel">
        <ChevronRightIcon className="h-4 w-4" />
      </Button>
    </div>
  );
}
