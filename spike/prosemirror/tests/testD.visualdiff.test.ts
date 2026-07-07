import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EditorState } from 'prosemirror-state'
import { EditorView, Decoration, DecorationSet } from 'prosemirror-view'
import { splitDocument, reinject } from '../src/lib/shell'
import { l1Schema } from '../src/lib/schemas'
import { parseFragment } from '../src/lib/roundtrip'
import { computeVisualDiff } from '../src/lib/diff'
import { loadFixtureHtml } from './fixtureLoader'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.resolve(__dirname, '../out')

const DIFF_STYLE = `
  <style id="diff-overlay">
    .diff-ins { background: rgba(16,185,129,0.25); text-decoration: underline; text-decoration-color: #10b981; }
    .diff-del { background: rgba(239,68,68,0.2); text-decoration: line-through; color: #fca5a5; }
  </style>
`

describe('Test D: visual diff via prosemirror-changeset + live EditorView in jsdom', () => {
  it('computes a changeset for 2 edited .desc paragraphs and writes out/diff.html', () => {
    const original = loadFixtureHtml()
    const { shell, bodyHtml } = splitDocument(original)
    const oldDoc = parseFragment(bodyHtml, l1Schema)

    const { newDoc, changes } = computeVisualDiff(oldDoc, l1Schema, [
      {
        match: (t) => t.includes('Tokenization, attention, KV cache'),
        newText:
          'Tokenization and context-window economics now ship with hosted debugging tools -- treat this as operational literacy, not research depth.',
      },
      {
        match: (t) => t.includes('"Executive-worker" pattern, tool contracts'),
        newText:
          'Tool contracts and memory layers matter, but treat the agent as a distributed system first and an LLM system only second.',
      },
    ])

    expect(changes.length).toBeGreaterThan(0)

    // Live EditorView in jsdom, decorated with insert/delete regions computed
    // from the changeset. Insertions are inline decorations on the new doc;
    // deletions don't exist in the new doc any more, so they're rendered as
    // widget decorations carrying the *old* doc's text at the deletion point.
    const state = EditorState.create({ doc: newDoc })
    const container = document.createElement('div')
    document.body.appendChild(container)

    const view = new EditorView(container, {
      state,
      decorations(viewState) {
        const decos: Decoration[] = []
        for (const change of changes) {
          if (change.toB > change.fromB) {
            decos.push(Decoration.inline(change.fromB, change.toB, { class: 'diff-ins' }))
          }
          if (change.toA > change.fromA) {
            const deletedText = oldDoc.textBetween(change.fromA, change.toA, ' ')
            decos.push(
              Decoration.widget(change.fromB, () => {
                const span = document.createElement('span')
                span.className = 'diff-del'
                span.textContent = deletedText
                return span
              }),
            )
          }
        }
        return DecorationSet.create(viewState.doc, decos)
      },
    })

    const decoratedBodyHtml = view.dom.innerHTML
    view.destroy()

    expect(decoratedBodyHtml).toContain('diff-ins')
    expect(decoratedBodyHtml).toContain('diff-del')
    expect(decoratedBodyHtml).toContain('Tokenization') // old text preserved via widget decoration
    expect(decoratedBodyHtml).toContain('hosted debugging tools') // new text present

    // Re-inject into the original shell + a small overlay stylesheet for the
    // diff classes (the fixture's own <style> knows nothing about them).
    const shellWithDiffCss = {
      pre: shell.pre.replace('</style>', `</style>${DIFF_STYLE}`),
      post: shell.post,
    }
    const fullDoc = reinject(shellWithDiffCss, decoratedBodyHtml)

    mkdirSync(OUT_DIR, { recursive: true })
    writeFileSync(path.join(OUT_DIR, 'diff.html'), fullDoc, 'utf-8')

    // eslint-disable-next-line no-console
    console.log(`\n=== TEST D: ${changes.length} changeset range(s) found ===`)
    for (const c of changes) {
      // eslint-disable-next-line no-console
      console.log(
        `  old[${c.fromA},${c.toA}) -> new[${c.fromB},${c.toB}): "${oldDoc
          .textBetween(c.fromA, c.toA, ' ')
          .slice(0, 40)}..." -> "${newDoc.textBetween(c.fromB, c.toB, ' ').slice(0, 40)}..."`,
      )
    }
  })
})
