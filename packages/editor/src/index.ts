export { buildSelectionAnchor, type SelectionAnchor, type SelectionAnchorInput } from "./anchor";
export {
  COMMENT_INTENT_COLORS,
  type HighlightIntent,
  type IntentHighlightColor,
  normalizeIntent,
} from "./comment-colors";
export {
  type CommentForHighlight,
  type CommentRange,
  commentHighlightsKey,
  resolvableCommentRanges,
} from "./comment-decorations";
export { createEditorState, docJson, editorPlugins } from "./editor-state";
export { buildIframeDocument, buildReadOnlyIframeDocument } from "./iframe-document";
export { type EditorSelection, ReportEditor, type ReportEditorProps } from "./ReportEditor";
