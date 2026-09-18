// Pure UI-state helpers for the in-viewer editor's collapsible side panel
// (edit-chrome-cleanup). Extracted so the two decisions that used to live
// inline in the route component — "how many active comments does the collapsed
// edge badge show" and "what does opening/switching the panel do" — are
// unit-testable without a mounted React tree (apps/view has no component-DOM
// test tier; see vitest.config.ts's `apps/view/app/edit/**/*.test.ts` glob and
// the `environment: "node"` note there).
import type { CommentWire } from "./wire-types";

/** Which tab the OPEN panel shows. Unlike the old `PanelTab` (which folded the
 *  closed state into a `null`), open/closed is now a separate boolean — the
 *  panel always has a remembered tab even while collapsed. */
export type PanelTab = "comments" | "versions";

export interface PanelState {
  /** Whether the side panel is expanded. Closed by default — the document is
   *  the dominant element until the user opens a tab. */
  readonly open: boolean;
  /** The tab the panel shows when open (persists across close/reopen). */
  readonly tab: PanelTab;
}

export const INITIAL_PANEL_STATE: PanelState = { open: false, tab: "comments" };

/** The tabs a URL is allowed to name. Derived from one place so a third tab
 *  cannot become deep-linkable by accident, nor stay un-linkable by omission. */
const PANEL_TABS: readonly PanelTab[] = ["comments", "versions"];

/**
 * The panel state a fresh editor mount starts in, given the `?panel=` search
 * param (#377).
 *
 * Version history lives in this panel rather than on a surface of its own, so
 * the owner view's Versions action (ADR-0089) had nowhere to point: it landed
 * on `/<slug>/edit` with the panel closed on comments, one click short of what
 * the owner asked for. This is the entry point that closes that gap.
 *
 * The param is a **hint, not a capability**. It chooses which tab a panel the
 * caller could already open starts on; it grants nothing, reveals nothing and
 * is read by no gate. An absent or unrecognised value is not an error — it is
 * simply not a hint, and falls back to `INITIAL_PANEL_STATE` itself (the
 * constant, not a copy of its value) so this function cannot drift from the
 * panel's own default.
 *
 * Read ONCE at mount, deliberately. Syncing panel state to the URL for the
 * rest of the session would make every tab switch a navigation and hand the
 * back button a job nobody asked it to do; the ticket asks for a way in, not a
 * live channel.
 */
export function initialPanelState(panel: string | null): PanelState {
  return PANEL_TABS.includes(panel as PanelTab)
    ? openPanel(panel as PanelTab)
    : INITIAL_PANEL_STATE;
}

/** Count of ACTIVE (unresolved) comment THREADS — root comments (`parent_id`
 *  null) whose `resolved_at` is null. Replies never count (they share their
 *  parent thread), and a resolved thread is done. This is the number the
 *  collapsed edge button surfaces as its badge. */
export function unresolvedCount(comments: readonly CommentWire[]): number {
  return comments.filter((c) => c.parent_id === null && c.resolved_at === null).length;
}

/** Open the panel to a specific tab (the collapsed edge arrow opens it to
 *  "comments"). Doesn't depend on prior state — opening always shows `tab`. */
export function openPanel(tab: PanelTab): PanelState {
  return { open: true, tab };
}

/** Collapse the panel, remembering the tab for the next open. */
export function closePanel(state: PanelState): PanelState {
  return { ...state, open: false };
}

/** Switch the in-panel tab. Only meaningful while open (the tab switcher only
 *  renders in the open panel's header), but keeping it total makes it trivial
 *  to reason about. */
export function selectPanelTab(state: PanelState, tab: PanelTab): PanelState {
  return { ...state, tab };
}
