import type { MarkSpec } from "prosemirror-model";
import { sanitizeStyle } from "./attrs.js";

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
        // style is sanitized on the way in (Fix 2, PR #151 review) — see
        // sanitizeStyle's doc comment in attrs.ts for what's stripped/why.
        return {
          class: dom.getAttribute("class"),
          style: sanitizeStyle(dom.getAttribute("style")),
        };
      },
    },
  ],
  toDOM(mark) {
    const attrs: Record<string, string> = {};
    if (mark.attrs.class) attrs.class = mark.attrs.class;
    // SECURITY (PR #156 review, Fix 1): re-sanitize at toDOM, not just at
    // parseDOM's getAttrs — a doc built via `Node.fromJSON` (diffRendered/
    // diffDocs's client-supplied `_source.json` sidecar) never calls
    // getAttrs, so an unsanitized `style` could otherwise pass straight
    // through untouched.
    const style = sanitizeStyle(mark.attrs.style);
    if (style) attrs.style = style;
    return ["span", attrs, 0];
  },
};
