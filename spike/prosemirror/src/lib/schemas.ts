import { Schema, type NodeSpec, type MarkSpec, type DOMOutputSpec } from 'prosemirror-model'
import { schema as basicSchema } from 'prosemirror-schema-basic'
import { addListNodes } from 'prosemirror-schema-list'
import { tableNodes } from 'prosemirror-tables'

// ============================================================================
// L0 -- out-of-the-box schema-basic + schema-list + tables, no customization.
// ============================================================================

const l0NodesWithLists = addListNodes(basicSchema.spec.nodes, 'paragraph block*', 'block')
const l0Nodes = l0NodesWithLists.append(
  tableNodes({ tableGroup: 'block', cellContent: 'block+', cellAttributes: {} }),
)

export const l0Schema = new Schema({
  nodes: l0Nodes,
  marks: basicSchema.spec.marks,
})

// ============================================================================
// L1 -- extend every known node/mark to retain class + style, and add a
// generic catch-all block node + inline mark for anything schema-basic
// doesn't otherwise recognize (div, section, aside, header, footer, nav,
// details, summary at the block level; span at the inline level).
// ============================================================================

/** Merge extra attributes into a DOMOutputSpec array of the form [tag, attrs?, ...children]. */
function mergeAttrsIntoOutputSpec(spec: DOMOutputSpec, extra: Record<string, unknown>): DOMOutputSpec {
  if (!Array.isArray(spec)) return spec
  const [tag, ...rest] = spec as unknown[]
  const hasAttrsObj =
    rest.length > 0 && typeof rest[0] === 'object' && rest[0] !== null && !Array.isArray(rest[0])
  const attrs: Record<string, unknown> = hasAttrsObj ? { ...(rest[0] as Record<string, unknown>) } : {}
  const children = hasAttrsObj ? rest.slice(1) : rest
  for (const [k, v] of Object.entries(extra)) {
    if (v != null && v !== '') attrs[k] = v
  }
  return [tag, attrs, ...children] as unknown as DOMOutputSpec
}

/** Wrap a node/mark spec so parsing captures class+style, and toDOM re-emits them. */
function addClassStyle<T extends NodeSpec | MarkSpec>(spec: T): T {
  const originalToDOM = spec.toDOM as ((n: any) => DOMOutputSpec) | undefined
  if (!originalToDOM) return spec
  return {
    ...spec,
    attrs: { ...(spec.attrs || {}), class: { default: null }, style: { default: null } },
    parseDOM: (spec.parseDOM || []).map((rule: any) => ({
      ...rule,
      // Rules may carry a *static* `attrs` object (e.g. schema-basic's
      // heading rules: `{tag: 'h2', attrs: {level: 2}}`) instead of a
      // `getAttrs` function. Fall back to that static object so we don't
      // silently discard it -- forgetting this collapsed every heading
      // level down to the schema default (an actual bug caught by running
      // the fixity test, not a hypothetical).
      getAttrs: (dom: HTMLElement) => {
        const base = rule.getAttrs ? rule.getAttrs(dom) : rule.attrs || null
        if (base === false) return false
        return {
          ...(base || {}),
          class: dom.getAttribute ? dom.getAttribute('class') : null,
          style: dom.getAttribute ? dom.getAttribute('style') : null,
        }
      },
    })),
    toDOM: (nodeOrMark: any) =>
      mergeAttrsIntoOutputSpec(originalToDOM(nodeOrMark), {
        class: nodeOrMark.attrs.class,
        style: nodeOrMark.attrs.style,
      }),
  } as T
}

// Reserved classes that get a dedicated node/mark at L2+ -- the generic
// catch-all rules skip elements bearing these classes so the dedicated
// rule (registered separately) is the only one that applies to them.
const CHIP_CLASS_RE = /(?:^|\s)chip(?:\s|$)/

function withClassStyle(map: typeof l0Nodes, name: string) {
  const spec = map.get(name)
  if (!spec) return map
  return map.update(name, addClassStyle(spec))
}

let l1Nodes = l0Nodes
for (const name of [
  'paragraph',
  'heading',
  'blockquote',
  'code_block',
  'bullet_list',
  'ordered_list',
  'list_item',
  'table',
  'table_row',
  'table_cell',
  'table_header',
]) {
  l1Nodes = withClassStyle(l1Nodes, name)
}

/** Generic catch-all block node for tags schema-basic has no concept of at all. */
const htmlBlock: NodeSpec = {
  group: 'block',
  // ProseMirror rejects content expressions that mix the `block` and
  // `inline` groups in one alternation ("Mixing inline and block content").
  // `block*` is the pragmatic choice: containers that hold bare inline
  // content directly (e.g. <div class="chips"><span>...</span></div>) get
  // that content auto-wrapped in a paragraph by the parser's generic
  // fill-in-the-blanks logic. That's an observed structural change (an
  // extra <p>), tracked as a finding rather than worked around further.
  content: 'block*',
  attrs: { tag: { default: 'div' }, class: { default: null }, style: { default: null }, open: { default: null } },
  parseDOM: [
    {
      tag: 'div, section, aside, header, footer, nav, details, summary',
      priority: 40,
      getAttrs(dom: HTMLElement) {
        return {
          tag: dom.tagName.toLowerCase(),
          class: dom.getAttribute('class'),
          style: dom.getAttribute('style'),
          open: dom.hasAttribute('open') ? 'open' : null,
        }
      },
    },
  ],
  toDOM(node) {
    const attrs: Record<string, string> = {}
    if (node.attrs.class) attrs.class = node.attrs.class
    if (node.attrs.style) attrs.style = node.attrs.style
    if (node.attrs.open) attrs.open = ''
    return [node.attrs.tag, attrs, 0]
  },
}

l1Nodes = l1Nodes.addToEnd('htmlBlock', htmlBlock)

/** Generic catch-all inline mark for <span> tags with no dedicated mark (L1 only -- chip gets its own mark at L2). */
const htmlInline: MarkSpec = {
  attrs: { class: { default: null }, style: { default: null } },
  parseDOM: [
    {
      tag: 'span',
      priority: 30,
      getAttrs(dom: HTMLElement) {
        // Let the dedicated chip mark (L2) own chip spans instead of double-wrapping them.
        if (CHIP_CLASS_RE.test(dom.getAttribute('class') || '')) return false
        return { class: dom.getAttribute('class'), style: dom.getAttribute('style') }
      },
    },
  ],
  toDOM(mark) {
    const attrs: Record<string, string> = {}
    if (mark.attrs.class) attrs.class = mark.attrs.class
    if (mark.attrs.style) attrs.style = mark.attrs.style
    return ['span', attrs, 0]
  },
}

let l1Marks = basicSchema.spec.marks
for (const name of ['link', 'code']) {
  const spec = l1Marks.get(name)
  if (spec) l1Marks = l1Marks.update(name, addClassStyle(spec))
}
l1Marks = l1Marks.addToEnd('htmlInline', htmlInline)

export const l1Schema = new Schema({ nodes: l1Nodes, marks: l1Marks })

// ============================================================================
// L2 -- L1 plus ONE real custom mark: `chip`, for
// <span class="chip chip-<variant>">...</span>. Preserves the exact variant
// (and therefore the exact class list, since toDOM reconstructs it) losslessly.
// ============================================================================

export const CHIP_VARIANTS = [
  'cto',
  'staff',
  'pm',
  'now',
  '1yr',
  '5yr',
  'have',
  'sharpen',
  'build',
] as const
export type ChipVariant = (typeof CHIP_VARIANTS)[number]

const chipMark: MarkSpec = {
  attrs: { variant: {} },
  parseDOM: CHIP_VARIANTS.map((variant) => ({
    tag: `span.chip-${variant}`,
    attrs: { variant },
  })),
  toDOM(mark) {
    return ['span', { class: `chip chip-${mark.attrs.variant}` }, 0]
  },
}

const l2Marks = l1Marks.addToEnd('chip', chipMark)
export const l2Schema = new Schema({ nodes: l1Nodes, marks: l2Marks })
