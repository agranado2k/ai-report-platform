import type { NodeSpec } from "prosemirror-model";
import { sanitizeStyle } from "./attrs.js";

/** Recognized paragraph roles (ADR-0062 §3), distinct from a bare `<p>`. */
export const PARAGRAPH_VARIANTS = ["desc", "lede", "sub"] as const;
export type ParagraphVariant = (typeof PARAGRAPH_VARIANTS)[number];

/**
 * Wraps the schema-basic `paragraph` node spec (already carrying generic
 * `class`/`style` retention via `withClassStyle`) with a `variant` attr for
 * the three recognized paragraph roles. This makes `.desc`/`.lede`/`.sub`
 * first-class schema vocabulary — distinguishable from an arbitrary,
 * unrecognized class on a `<p>` — while still falling back to the generic
 * `class` attr for round-tripping a bare `<p>` or a future/unknown class.
 */
export function withParagraphVariant(spec: NodeSpec): NodeSpec {
  return {
    ...spec,
    attrs: { ...(spec.attrs ?? {}), variant: { default: null } },
    parseDOM: (spec.parseDOM ?? []).map((rule) => ({
      ...rule,
      getAttrs(dom: HTMLElement) {
        const base = rule.getAttrs ? rule.getAttrs(dom) : (rule.attrs ?? {});
        if (base === false) return false;
        const className = dom.getAttribute ? dom.getAttribute("class") : null;
        const variant =
          (PARAGRAPH_VARIANTS as readonly string[]).find((v) => v === className) ?? null;
        return { ...(base || {}), variant };
      },
    })),
    toDOM(node) {
      const tag = "p";
      const className = node.attrs.variant ?? node.attrs.class ?? null;
      const attrs: Record<string, string> = {};
      if (className) attrs.class = className;
      // SECURITY (PR #156 review, Fix 1): this toDOM entirely replaces the
      // withClassStyle-wrapped one it's built on top of (see
      // withParagraphVariant's doc comment) — including that wrapper's
      // sanitizeStyle call — so it's re-applied here rather than trusting
      // node.attrs.style, which a doc built via Node.fromJSON (diffRendered/
      // diffDocs's client-supplied sidecar) never ran through getAttrs.
      const style = sanitizeStyle(node.attrs.style);
      if (style) attrs.style = style;
      return [tag, attrs, 0];
    },
  };
}
