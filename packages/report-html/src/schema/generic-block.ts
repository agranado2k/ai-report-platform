import type { NodeSpec } from "prosemirror-model";
import { sanitizeStyle } from "./attrs.js";

/**
 * The only tags this catch-all is allowed to render as — mirrors the
 * `parseDOM` tag selector below (single source of truth for both).
 */
export const HTML_BLOCK_TAGS = ["div", "aside", "header", "footer", "nav", "main"] as const;

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
 *
 * SECURITY (PR #156 review, Fix 1): `parseDOM`'s `getAttrs` only ever hands
 * back a tag drawn from the selector below, and only a sanitized style — but
 * that's a PARSE-time guarantee. `diffRendered`/`diffDocs` build docs via
 * `Node.fromJSON` from a client-supplied `_source.json` sidecar, which never
 * calls `parseDOM`/`getAttrs` — a JSON payload can set `attrs.tag` to
 * `"script"`/`"iframe"`/anything, and an unsanitized `attrs.style` straight
 * through. `toDOM` is the one place every doc — however it was built —
 * passes through before becoming a real DOM attribute, so both checks are
 * re-applied here: a non-whitelisted tag coerces to `"div"` rather than
 * rendering as-is, and `style` is re-sanitized rather than trusted.
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
      tag: HTML_BLOCK_TAGS.join(", "),
      priority: 40,
      getAttrs(dom: HTMLElement) {
        // style is sanitized on the way in (Fix 2, PR #151 review) — see
        // sanitizeStyle's doc comment in attrs.ts for what's stripped/why.
        return {
          tag: dom.tagName.toLowerCase(),
          class: dom.getAttribute("class"),
          style: sanitizeStyle(dom.getAttribute("style")),
        };
      },
    },
  ],
  toDOM(node) {
    const tag = (HTML_BLOCK_TAGS as readonly string[]).includes(node.attrs.tag)
      ? node.attrs.tag
      : "div";
    const attrs: Record<string, string> = {};
    if (node.attrs.class) attrs.class = node.attrs.class;
    const style = sanitizeStyle(node.attrs.style);
    if (style) attrs.style = style;
    return [tag, attrs, 0];
  },
};
