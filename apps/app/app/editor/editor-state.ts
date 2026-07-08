// Pure ProseMirror wiring for the report editor (ADR-0062 §1/§3, editor MVP —
// toolbar-free: typing + marks via keymap). Needs no DOM (unlike the mounted
// `EditorView`, which `ReportEditor.tsx` owns) — the state/transform layer of
// ProseMirror is plain JS, so this module is cheaply unit-testable (see
// editor-state.test.ts) even though the rest of the Remix UI stays e2e-only.

import { type PMDocJson, reportSchema } from "arp-report-html";
import { baseKeymap, toggleMark } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { Node as PMNode } from "prosemirror-model";
import type { Plugin } from "prosemirror-state";
import { EditorState } from "prosemirror-state";
import { commentHighlightsPlugin } from "./comment-decorations";

/** Look up a mark type reportSchema is known to define (schema.ts builds on
 *  prosemirror-schema-basic, which always defines `strong`/`em`) — throws
 *  loudly on a schema regression instead of silently binding `undefined`. */
function requireMark(name: string) {
  const mark = reportSchema.marks[name];
  if (!mark) throw new Error(`reportSchema has no '${name}' mark`);
  return mark;
}

/** The keymap-bound plugins for the MVP editor: history (undo/redo), a
 *  handful of mark toggles (bold/italic), ProseMirror's baseKeymap
 *  (Enter/Backspace/Delete/arrow-key list handling, etc.), and the comment
 *  highlight decoration plugin (ADR-0064 §2a — comment-decorations.ts). No
 *  toolbar — every keymap binding here is reachable only by keyboard, per the
 *  MVP scope; the comment highlights are seeded/updated externally via
 *  `tr.setMeta(commentHighlightsKey, ranges)`, not a keymap command. */
export function editorPlugins(): Plugin[] {
  return [
    history(),
    keymap({
      "Mod-z": undo,
      "Mod-y": redo,
      "Shift-Mod-z": redo,
      "Mod-b": toggleMark(requireMark("strong")),
      "Mod-i": toggleMark(requireMark("em")),
    }),
    keymap(baseKeymap),
    commentHighlightsPlugin(),
  ];
}

/** Build the initial editor state from the lossless `_source.json` doc JSON
 *  (ADR-0062 §4) — the shape `arp-report-html`'s `parseBody`/`PMDocJson`
 *  produce and `Node#toJSON()`/`Node.fromJSON()` (de)serialize. */
export function createEditorState(doc: PMDocJson): EditorState {
  const node = PMNode.fromJSON(reportSchema, doc);
  return EditorState.create({ doc: node, schema: reportSchema, plugins: editorPlugins() });
}

/** The current document as PM doc JSON — what gets persisted back as the
 *  `_source.json` sidecar on save. */
export function docJson(state: EditorState): PMDocJson {
  return state.doc.toJSON() as PMDocJson;
}
