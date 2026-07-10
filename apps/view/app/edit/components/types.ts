// Shared UI-only types for the unified experience's layout (TopBar +
// the route component's panel state) — kept separate from wire-types.ts,
// which is strictly the app-origin API's response shapes.

/** Which tab the left panel shows, or `null` when the panel is closed
 *  (HIDDEN by default — the document is the dominant element until the user
 *  opens Comments or Versions). */
export type PanelTab = "comments" | "versions" | null;
