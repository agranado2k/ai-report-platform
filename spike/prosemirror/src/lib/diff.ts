import { Transform } from 'prosemirror-transform'
import { ChangeSet } from 'prosemirror-changeset'
import type { Node as PMNode, Schema } from 'prosemirror-model'
import { findTextblockRange, type Range } from './suggestion'

export interface Edit {
  /** Matches the *original* full text of the textblock to replace. */
  match: (text: string) => boolean
  newText: string
}

export interface VisualDiffResult {
  readonly oldDoc: PMNode
  readonly newDoc: PMNode
  readonly changes: readonly { fromA: number; toA: number; fromB: number; toB: number }[]
}

/**
 * Apply a series of whole-textblock text replacements to `oldDoc` via a
 * single Transform (so the resulting step maps are exactly what
 * prosemirror-changeset expects), then diff the two documents with
 * ChangeSet.
 */
export function computeVisualDiff(oldDoc: PMNode, schema: Schema, edits: readonly Edit[]): VisualDiffResult {
  const tr = new Transform(oldDoc)
  for (const edit of edits) {
    // Re-find the range against tr.doc each time -- earlier edits may have
    // shifted positions for anything after them.
    const range: Range | null = findTextblockRange(tr.doc, edit.match)
    if (!range) {
      throw new Error(`computeVisualDiff: no textblock matched for edit "${edit.newText.slice(0, 30)}..."`)
    }
    tr.replaceWith(range.from, range.to, schema.text(edit.newText))
  }

  const changeSet = ChangeSet.create(oldDoc).addSteps(tr.doc, tr.mapping.maps as any, null)

  return { oldDoc, newDoc: tr.doc, changes: changeSet.changes }
}
