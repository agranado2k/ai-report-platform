import { Transform } from 'prosemirror-transform'
import type { Node as PMNode, MarkType, Schema } from 'prosemirror-model'

/**
 * Minimal from-scratch "suggestion mode": mark the old text as pending-delete
 * (kept visible, struck through) and insert the canned replacement right
 * after it as pending-insert (kept visible, underlined). Accept/reject then
 * just resolve those two marks -- there's no separate "pending suggestion"
 * data structure to keep in sync, the marks in the doc ARE the pending state.
 *
 * We evaluated prosemirror-changeset for this first (see Test D, where it's
 * used for structural diffing between two doc snapshots) but it computes a
 * diff between two *finished* documents/step sequences -- it has no built-in
 * notion of "a suggestion currently pending review that a human can later
 * accept or reject". Modeling that needs persistent marks anyway, so we
 * built the marks directly rather than going through changeset for this part.
 */

export interface Range {
  readonly from: number
  readonly to: number
}

/** Find the first textblock node whose full text content satisfies `predicate`. */
export function findTextblockRange(doc: PMNode, predicate: (text: string) => boolean): Range | null {
  let found: Range | null = null
  doc.descendants((node, pos) => {
    if (found) return false
    if (node.isTextblock && predicate(node.textContent)) {
      found = { from: pos + 1, to: pos + node.nodeSize - 1 }
      return false
    }
    return true
  })
  return found
}

/** Find the (single, contiguous-assumed) range of text carrying the given mark type. */
export function findMarkRange(doc: PMNode, markType: MarkType): Range | null {
  let from = -1
  let to = -1
  doc.descendants((node, pos) => {
    if (node.isText && markType.isInSet(node.marks)) {
      if (from === -1) from = pos
      to = pos + node.nodeSize
    }
  })
  return from === -1 ? null : { from, to }
}

/**
 * Propose a suggestion: mark [from,to) as pending-delete, and insert
 * `replacement` right after it as pending-insert. Both are visible in the
 * resulting doc simultaneously (classic track-changes look).
 */
export function proposeSuggestion(doc: PMNode, schema: Schema, range: Range, replacement: string): PMNode {
  const tr = new Transform(doc)
  tr.addMark(range.from, range.to, schema.marks.suggestionDelete.create())
  tr.insert(range.to, schema.text(replacement, [schema.marks.suggestionInsert.create()]))
  return tr.doc
}

/** Accept: drop the pending-delete text entirely; make the pending-insert text permanent. */
export function acceptSuggestion(doc: PMNode, schema: Schema): PMNode {
  const tr = new Transform(doc)
  const deleteRange = findMarkRange(doc, schema.marks.suggestionDelete)
  if (deleteRange) tr.delete(deleteRange.from, deleteRange.to)
  const insertRange = findMarkRange(tr.doc, schema.marks.suggestionInsert)
  if (insertRange) tr.removeMark(insertRange.from, insertRange.to, schema.marks.suggestionInsert)
  return tr.doc
}

/** Reject: drop the pending-insert text entirely; restore the pending-delete text to plain/unmarked. */
export function rejectSuggestion(doc: PMNode, schema: Schema): PMNode {
  const tr = new Transform(doc)
  const insertRange = findMarkRange(doc, schema.marks.suggestionInsert)
  if (insertRange) tr.delete(insertRange.from, insertRange.to)
  const deleteRange = findMarkRange(tr.doc, schema.marks.suggestionDelete)
  if (deleteRange) tr.removeMark(deleteRange.from, deleteRange.to, schema.marks.suggestionDelete)
  return tr.doc
}
