import * as React from "react";
import { createTSlatePlugin } from "platejs";
import { SlateElement } from "platejs/static";

/**
 * L2 — ONE real, structured custom element: the report's `.chip` badge
 * (`<span class="chip chip-cto">CTO</span>`, `chip-now`, `chip-have`, etc).
 *
 * Unlike L1's generic passthrough (which is variant-blind — it just remembers
 * "class was some string"), this element PARSES the variant out of the class
 * list into a real, structured `variant` field on the node
 * (`{ type: "chip", variant: "cto", children: [...] }`). That's the point of
 * a bespoke element: it turns a styling convention into a first-class,
 * editable piece of document semantics (e.g. a future toolbar could offer a
 * "change chip variant" dropdown reading/writing this field, something no
 * amount of generic class-string preservation gives you for free).
 */

const CHIP_VARIANTS = [
  "cto",
  "staff",
  "pm",
  "have",
  "sharpen",
  "build",
  "now",
  "1yr",
  "5yr",
] as const;

function variantFromClassList(classList: DOMTokenList): string | undefined {
  for (const cls of classList) {
    const match = /^chip-(.+)$/.exec(cls);
    if (match) return match[1];
  }
  return undefined;
}

function ChipStaticElement(props: any) {
  const { element, children } = props;
  const variant = element.variant as string | undefined;
  const className = variant ? `chip chip-${variant}` : "chip";

  return (
    <SlateElement {...props} as="span" className={className}>
      {children}
    </SlateElement>
  );
}

export const ChipPlugin = createTSlatePlugin({
  key: "chip",
  priority: 10, // deserializer rules are checked in *reverse* priority
  // order in this Plate version (packages/core .../pipeDeserializeHtmlElement
  // reverses meta.pluginList, which is priority-descending) — a *lower*
  // number here means "tried earlier", so this wins over the generic SPAN
  // passthrough (L1, default priority 100) for `<span class="chip ...">`.
  node: { isElement: true, isInline: true },
  parsers: {
    html: {
      deserializer: {
        rules: [{ validNodeName: "SPAN", validClassName: "chip" }],
        parse: ({ element, type }) => ({
          type,
          variant: variantFromClassList(element.classList),
        }),
      },
    },
  },
  render: { as: "span", node: ChipStaticElement },
});

export const CHIP_KNOWN_VARIANTS = CHIP_VARIANTS;
