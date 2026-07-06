import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { ySyncPlugin, yCursorPlugin, yUndoPlugin } from 'y-prosemirror'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { l1Schema } from '../src/lib/schemas'

describe('Collab smoke check (yjs + y-prosemirror, no server/persistence)', () => {
  it('constructs a Y.Doc, a Y.XmlFragment, and wires the y-prosemirror binding without throwing', () => {
    const ydoc = new Y.Doc()
    const xmlFragment = ydoc.getXmlFragment('prosemirror')
    const awareness = new Awareness(ydoc)

    const plugins = [ySyncPlugin(xmlFragment), yCursorPlugin(awareness), yUndoPlugin()]

    const state = EditorState.create({ schema: l1Schema, plugins })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const view = new EditorView(container, { state })

    expect(view.state.doc).toBeTruthy()
    expect(xmlFragment).toBeInstanceOf(Y.XmlFragment)

    view.destroy()
    awareness.destroy()
    ydoc.destroy()
  })
})
