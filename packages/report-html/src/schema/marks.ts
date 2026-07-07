import type { MarkSpec } from "prosemirror-model";

/** `pill` mark (ADR-0062 §3) — `<span class="pill">`. No variant/attrs. */
export const pillMark: MarkSpec = {
  parseDOM: [{ tag: "span.pill" }],
  toDOM() {
    return ["span", { class: "pill" }, 0];
  },
};

/** `kbd` mark (ADR-0062 §3) — `<span class="kbd">`. No variant/attrs. */
export const kbdMark: MarkSpec = {
  parseDOM: [{ tag: "span.kbd" }],
  toDOM() {
    return ["span", { class: "kbd" }, 0];
  },
};

/**
 * Generic attr-retention catch-all mark for `<span>` tags with no dedicated
 * mark (ADR-0062 §3). Given a *lower* priority than the dedicated inline
 * marks (chip/pill/kbd — all default priority 50) so a `<span class="chip
 * chip-cto">` is matched by the `chip` mark's rule first; this rule only
 * ever sees spans none of the dedicated rules claimed.
 */
export const htmlInlineMark: MarkSpec = {
  attrs: { class: { default: null }, style: { default: null } },
  parseDOM: [
    {
      tag: "span",
      priority: 20,
      getAttrs(dom: HTMLElement) {
        return { class: dom.getAttribute("class"), style: dom.getAttribute("style") };
      },
    },
  ],
  toDOM(mark) {
    const attrs: Record<string, string> = {};
    if (mark.attrs.class) attrs.class = mark.attrs.class;
    if (mark.attrs.style) attrs.style = mark.attrs.style;
    return ["span", attrs, 0];
  },
};
