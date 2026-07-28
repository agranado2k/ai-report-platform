// Shared UI-only types for the unified experience's layout (TopBar +
// the route component's panel state) — kept separate from wire-types.ts,
// which is strictly the app-origin API's response shapes.
//
// The panel's open/closed + which-tab state now lives as pure helpers in
// ../panel.ts (`PanelState`, `PanelTab`, `unresolvedCount`, …) so it's
// unit-testable without a mounted tree. Re-export `PanelTab` here so the
// chrome components keep a single import surface for layout types.
export type { PanelTab } from "../panel";
