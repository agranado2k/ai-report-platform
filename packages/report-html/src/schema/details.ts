import type { NodeSpec } from "prosemirror-model";

/**
 * `details` / `summary` (ADR-0062 §3). The fixture never instantiates a bare
 * `<details>` — every occurrence is `<details class="resgroup card" open>`,
 * i.e. what the ADR separately calls out as the `resgroup` block. Rather
 * than adding a redundant `resgroup` node type that would only ever
 * duplicate `details` (same tag, same content shape), `resgroup`'s grouping
 * role is expressed *as* a `details` node whose `class` attr happens to be
 * `"resgroup card"` — consistent with the verbatim-class-retention pattern
 * used for `card`/`grid`/etc. `resrow` (below) is the one piece of that
 * bullet with genuine structural distinctness, so it gets its own node.
 */
export const detailsNode: NodeSpec = {
  group: "block",
  content: "summary block*",
  attrs: { class: { default: null }, open: { default: null } },
  parseDOM: [
    {
      tag: "details",
      getAttrs(dom: HTMLElement) {
        return {
          class: dom.getAttribute("class"),
          open: dom.hasAttribute("open") ? dom.getAttribute("open") : null,
        };
      },
    },
  ],
  toDOM(node) {
    const attrs: Record<string, string> = {};
    if (node.attrs.class) attrs.class = node.attrs.class;
    if (node.attrs.open != null) attrs.open = node.attrs.open;
    return ["details", attrs, 0];
  },
};

export const summaryNode: NodeSpec = {
  content: "inline*",
  parseDOM: [{ tag: "summary" }],
  toDOM() {
    return ["summary", 0];
  },
};

/**
 * `resrow` (ADR-0062 §3) — `<div class="resrow">`, a grouped result row
 * (title/meta/description + a tag column). The ADR doesn't specify attrs
 * for its children (`rt`/`rmeta`/`rd`/`rtags`/`ref`) — the fixture never
 * gives them anything beyond a class, so they fall to the generic
 * attr-retention block/inline catch-alls rather than getting dedicated
 * nodes of their own (see the judgment call in the PR description).
 */
export const resrowNode: NodeSpec = {
  group: "block",
  content: "block*",
  attrs: { class: { default: "resrow" } },
  parseDOM: [
    {
      tag: "div.resrow",
      getAttrs(dom: HTMLElement) {
        return { class: dom.getAttribute("class") };
      },
    },
  ],
  toDOM(node) {
    return ["div", { class: node.attrs.class }, 0];
  },
};
