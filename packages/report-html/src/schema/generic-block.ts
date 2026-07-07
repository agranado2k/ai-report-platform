import type { NodeSpec } from "prosemirror-model";

/**
 * Generic attr-retention catch-all block node (ADR-0062 §3) for any HTML tag
 * with no dedicated node spec: `div`, `aside`, `header`, `footer`, `nav`,
 * `main`. (`section`, `details`, `summary` get their own dedicated specs —
 * see nodes.ts — so are excluded here.)
 *
 * `content: 'block*'` is the accepted cost from ADR-0062 §7: containers that
 * hold bare inline content directly in the source HTML (e.g. `<div
 * class="chips"><span>...</span></div>`) get that content auto-wrapped in a
 * paragraph by ProseMirror's generic fill-in-the-blanks logic when parsed.
 * That's a real, observed structural change (an extra `<p>`), pinned as a
 * contract in auto-wrap.test.ts rather than fought here.
 */
export const htmlBlockNode: NodeSpec = {
  group: "block",
  content: "block*",
  attrs: {
    tag: { default: "div" },
    class: { default: null },
    style: { default: null },
  },
  parseDOM: [
    {
      tag: "div, aside, header, footer, nav, main",
      priority: 40,
      getAttrs(dom: HTMLElement) {
        return {
          tag: dom.tagName.toLowerCase(),
          class: dom.getAttribute("class"),
          style: dom.getAttribute("style"),
        };
      },
    },
  ],
  toDOM(node) {
    const attrs: Record<string, string> = {};
    if (node.attrs.class) attrs.class = node.attrs.class;
    if (node.attrs.style) attrs.style = node.attrs.style;
    return [node.attrs.tag, attrs, 0];
  },
};
