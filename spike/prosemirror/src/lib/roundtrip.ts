import { DOMParser as PMDOMParser, DOMSerializer, type Schema, type Node as PMNode } from 'prosemirror-model'

/**
 * Parse an HTML fragment string into a ProseMirror doc using the given
 * schema. Requires a DOM (jsdom in tests, browser DOM in the app).
 */
export function parseFragment(html: string, schema: Schema): PMNode {
  const container = document.createElement('div')
  container.innerHTML = html
  return PMDOMParser.fromSchema(schema).parse(container)
}

/**
 * Serialize a ProseMirror doc's content back to an HTML string (the
 * innerHTML of a detached container element).
 */
export function serializeDoc(doc: PMNode, schema: Schema): string {
  const serializer = DOMSerializer.fromSchema(schema)
  const fragment = serializer.serializeFragment(doc.content)
  const container = document.createElement('div')
  container.appendChild(fragment)
  return container.innerHTML
}

/** Convenience: parse then immediately re-serialize -- the full round-trip under test. */
export function roundtrip(html: string, schema: Schema): string {
  const doc = parseFragment(html, schema)
  return serializeDoc(doc, schema)
}
