export { buildSelectionAnchor, type SelectionAnchor, type SelectionAnchorInput } from "./anchor";
export {
  COMMENT_INTENT_COLORS,
  type HighlightIntent,
  type IntentHighlightColor,
  normalizeIntent,
} from "./comment-colors";
export {
  type ClickPoint,
  type CommentForHighlight,
  type CommentRange,
  clickedCommentId,
  commentHighlightsKey,
  commentIdAtPos,
  jumpTargetForComment,
  resolvableCommentRanges,
} from "./comment-decorations";
export {
  createEditorState,
  docJson,
  type EditorSelection,
  editorPlugins,
  jumpToCommentTransaction,
  reportableSelection,
} from "./editor-state";
export { buildIframeDocument, buildReadOnlyIframeDocument } from "./iframe-document";
export { ReportEditor, type ReportEditorHandle, type ReportEditorProps } from "./ReportEditor";
