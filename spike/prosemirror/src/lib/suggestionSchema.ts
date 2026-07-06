import { Schema, type MarkSpec } from 'prosemirror-model'
import { l1Schema } from './schemas'

/**
 * Test C/D need two marks the fixture itself has no concept of: a pending
 * "suggested insert" and a pending "suggested delete", rendered distinctly
 * (<ins>/<del>-alike) so accept/reject can be driven off which mark is
 * present rather than off any diffing logic re-run at accept/reject time.
 */
const suggestionInsert: MarkSpec = {
  toDOM: () => ['ins', { class: 'pm-suggest-insert' }, 0],
  parseDOM: [{ tag: 'ins.pm-suggest-insert' }],
}

const suggestionDelete: MarkSpec = {
  toDOM: () => ['del', { class: 'pm-suggest-delete' }, 0],
  parseDOM: [{ tag: 'del.pm-suggest-delete' }],
}

const suggestionMarks = l1Schema.spec.marks.addToEnd('suggestionInsert', suggestionInsert).addToEnd('suggestionDelete', suggestionDelete)

export const suggestionSchema = new Schema({
  nodes: l1Schema.spec.nodes,
  marks: suggestionMarks,
})
