export { buildSelectionAnchor, type SelectionAnchor, type SelectionAnchorInput } from "./anchor";
export { CLICK_SLOP_PX, type ClickPoint, isClickNotDrag } from "./click-gesture";
export {
  COMMENT_INTENT_COLORS,
  type HighlightIntent,
  type IntentHighlightColor,
  normalizeIntent,
} from "./comment-colors";
export {
  type CommentForHighlight,
  type CommentRange,
  clickedCommentId,
  commentHighlightsKey,
  commentIdAtPos,
  jumpTargetForComment,
  resolvableCommentRanges,
} from "./comment-decorations";
// `currentSelection` / `isProgrammaticSelection` are deliberately NOT on
// this barrel: the first bypasses the programmatic-selection gate (its doc
// comment says "never use where a transaction is in hand"), and both exist
// solely for ReportEditor's internal mouseup latch. In-package code imports
// them from ./editor-state directly; nothing outside should.
export {
  anchorScrollTransaction,
  createEditorState,
  docJson,
  type EditorSelection,
  editorPlugins,
  jumpToCommentTransaction,
  reportableSelection,
} from "./editor-state";
// The formatting seam's CONSUMED surface (ticket #297): the SelectionToolbar
// (apps/view) needs the TYPES to declare its props — the functions themselves
// (`activeFormats`, `toggleFormatCommand`) stay in-package, reached only
// through ReportEditor's selection reports and `toggleFormat` handle, so no
// host is invited to grow a second active-state or command path.
export type { ActiveFormats, ToggleableFormat } from "./formatting";
export { buildIframeDocument, buildReadOnlyIframeDocument } from "./iframe-document";
export {
  type EditorClickOutcome,
  editorClickOutcome,
  type LinkActivation,
  type LinkActivationInput,
  type LinkLike,
  linkActivation,
  linkMarkAtPos,
} from "./link-activation";
export { ReportEditor, type ReportEditorHandle, type ReportEditorProps } from "./ReportEditor";
// Only the toolbar seam's CONSUMED surface is published (claude-review #301
// L-4): hosts receive a ready-made host-space `SelectionGeometry` and place
// with `placeToolbar` — the translation internals (`selectionGeometry`,
// `FrameRect`, `PositionCoords`, the gap/margin constants) stay in-package,
// so no host is invited to redo the iframe translation itself.
export type { SelectionGeometry } from "./selection-rect";
export {
  placeToolbar,
  type SelectionRect,
  type ToolbarPlacementInput,
  type ToolbarPosition,
} from "./toolbar-placement";
