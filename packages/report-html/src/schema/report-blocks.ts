import type { NodeSpec } from "prosemirror-model";

/**
 * `section` (ADR-0062 §3) — a top-level report section. Retains `id`
 * (never `class` — the fixture's `<section>` elements are always bare
 * except for the id the sidebar TOC anchors to, e.g. `href="#summary"`;
 * dropping it would silently break every in-page anchor link).
 */
export const sectionNode: NodeSpec = {
  group: "block",
  content: "block*",
  attrs: { id: { default: null } },
  parseDOM: [
    {
      tag: "section",
      getAttrs(dom: HTMLElement) {
        return { id: dom.getAttribute("id") };
      },
    },
  ],
  toDOM(node) {
    const attrs: Record<string, string> = {};
    if (node.attrs.id) attrs.id = node.attrs.id;
    return ["section", attrs, 0];
  },
};

/**
 * `card` (ADR-0062 §3) — `<div class="card">`, and its many co-occurring
 * variants (`card pillar pillar-A`, `card legend-card`, ...). `class` is
 * retained verbatim (the full attribute string) rather than reduced to a
 * boolean/enum, so every combination round-trips exactly — the fixture
 * never combines `card` with more than a handful of modifier classes, but
 * nothing here assumes a closed set.
 */
export const cardNode: NodeSpec = {
  group: "block",
  content: "block*",
  attrs: { class: { default: "card" } },
  parseDOM: [
    {
      tag: "div.card",
      getAttrs(dom: HTMLElement) {
        return { class: dom.getAttribute("class") };
      },
    },
  ],
  toDOM(node) {
    return ["div", { class: node.attrs.class }, 0];
  },
};

/**
 * `checklist` / implicit `checklist_item` (ADR-0062 §3) — `<ul
 * class="checklist"><li>...`. Item content is `inline*` (text + marks
 * directly, no wrapping `<p>`) rather than the generic-list default,
 * matching the fixture exactly (`<li>Chip Huyen · <em>AI Engineering</em></li>`,
 * no paragraph wrapper) and avoiding the unwanted `p { margin: 0 0
 * 0.9rem; }` spacing a wrapped `<p>` would introduce inside a checklist row.
 */
export const checklistNode: NodeSpec = {
  group: "block",
  content: "checklist_item+",
  parseDOM: [
    {
      tag: "ul.checklist",
      // Higher than the default-50 priority of the generic bullet_list
      // node's plain `ul` rule, which would otherwise also match (and,
      // depending on registration order, could win) a `<ul class="checklist">`.
      priority: 60,
    },
  ],
  toDOM() {
    return ["ul", { class: "checklist" }, 0];
  },
};

export const checklistItemNode: NodeSpec = {
  content: "inline*",
  parseDOM: [{ tag: "ul.checklist > li", priority: 60 }],
  toDOM() {
    return ["li", 0];
  },
};

/**
 * `grid` (ADR-0062 §3) — `<div class="grid g2">` / `.grid.g3` / etc. The
 * column-count variant is captured both as a derived `cols` number (for
 * future editing UX — e.g. a column-count stepper) and verbatim in `class`
 * (so `toDOM` re-emits the exact original class list regardless of what
 * else might accompany it).
 */
const GRID_COLS_RE = /(?:^|\s)g(\d+)(?:\s|$)/;

export const gridNode: NodeSpec = {
  group: "block",
  content: "block*",
  attrs: { class: { default: "grid" }, cols: { default: null } },
  parseDOM: [
    {
      tag: "div.grid",
      getAttrs(dom: HTMLElement) {
        const className = dom.getAttribute("class");
        const match = className ? GRID_COLS_RE.exec(className) : null;
        return { class: className, cols: match ? Number(match[1]) : null };
      },
    },
  ],
  toDOM(node) {
    return ["div", { class: node.attrs.class }, 0];
  },
};
