import type { NodeSpec } from "prosemirror-model";

/**
 * Custom table node specs (ADR-0062 §3, §7 accepted cost) — `prosemirror-
 * tables` has no `thead`/`tbody` concept (its `tableNodes()` helper flattens
 * straight to `table > tr > td/th`), so `<table><thead>…</thead><tbody>…
 * </tbody></table>` doesn't round-trip through it. Both fixture tables have
 * real `thead`/`tbody`, so this package implements its own minimal node set
 * instead of depending on `prosemirror-tables`.
 *
 * This is a plain document-model table (no column resizing, cell merging,
 * or the editing commands `prosemirror-tables` provides) — exactly the
 * "custom tableNodes extension" scoped by ADR-0062 §7, not a general
 * replacement for that package's editing feature set.
 */

export const tablewrapNode: NodeSpec = {
  group: "block",
  content: "table",
  attrs: { class: { default: "tablewrap" } },
  parseDOM: [
    {
      tag: "div.tablewrap",
      getAttrs(dom: HTMLElement) {
        return { class: dom.getAttribute("class") };
      },
    },
  ],
  toDOM(node) {
    return ["div", { class: node.attrs.class }, 0];
  },
};

export const tableNode: NodeSpec = {
  content: "table_head? table_body",
  attrs: { class: { default: null } },
  parseDOM: [
    {
      tag: "table",
      getAttrs(dom: HTMLElement) {
        return { class: dom.getAttribute("class") };
      },
    },
  ],
  toDOM(node) {
    const attrs: Record<string, string> = {};
    if (node.attrs.class) attrs.class = node.attrs.class;
    return ["table", attrs, 0];
  },
};

export const tableHeadNode: NodeSpec = {
  content: "table_row+",
  parseDOM: [{ tag: "thead" }],
  toDOM() {
    return ["thead", 0];
  },
};

export const tableBodyNode: NodeSpec = {
  content: "table_row+",
  parseDOM: [{ tag: "tbody" }],
  toDOM() {
    return ["tbody", 0];
  },
};

export const tableRowNode: NodeSpec = {
  content: "(table_header | table_cell)+",
  parseDOM: [{ tag: "tr" }],
  toDOM() {
    return ["tr", 0];
  },
};

export const tableHeaderNode: NodeSpec = {
  content: "inline*",
  attrs: { style: { default: null } },
  parseDOM: [
    {
      tag: "th",
      getAttrs(dom: HTMLElement) {
        return { style: dom.getAttribute("style") };
      },
    },
  ],
  toDOM(node) {
    const attrs: Record<string, string> = {};
    if (node.attrs.style) attrs.style = node.attrs.style;
    return ["th", attrs, 0];
  },
};

export const tableCellNode: NodeSpec = {
  content: "inline*",
  attrs: { style: { default: null } },
  parseDOM: [
    {
      tag: "td",
      getAttrs(dom: HTMLElement) {
        return { style: dom.getAttribute("style") };
      },
    },
  ],
  toDOM(node) {
    const attrs: Record<string, string> = {};
    if (node.attrs.style) attrs.style = node.attrs.style;
    return ["td", attrs, 0];
  },
};
