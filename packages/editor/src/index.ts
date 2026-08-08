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
export {
  anchorScrollTransaction,
  createEditorState,
  currentSelection,
  docJson,
  type EditorSelection,
  editorPlugins,
  jumpToCommentTransaction,
  reportableSelection,
} from "./editor-state";
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
export {
  type FrameRect,
  type PositionCoords,
  type SelectionGeometry,
  selectionGeometry,
} from "./selection-rect";
export {
  placeToolbar,
  type SelectionRect,
  TOOLBAR_GAP_PX,
  TOOLBAR_MARGIN_PX,
  type ToolbarPlacementInput,
  type ToolbarPosition,
} from "./toolbar-placement";
