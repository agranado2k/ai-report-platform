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
