import * as React from "react";
import { createTSlatePlugin } from "platejs";
import { SlateElement } from "platejs/static";

/**
 * L1 — "best-effort config to retain unknown classes/attributes on generic
 * elements."
 *
 * FINDING (see report "L2 custom node effort" / DX notes): Plate's
 * config-only attribute passthrough (`node.props` remapping raw HTML attrs
 * to React DOM prop names) does NOT actually survive to the static-export
 * HTML. `getRenderNodeStaticProps` (packages/core/src/static/utils/
 * getRenderNodeStaticProps.ts) unconditionally recomputes
 * `attributes.className` from the plugin's own `slate-<type>` class,
 * clobbering whatever `node.props` returned:
 *
 *   attributes: { ...pluginProps.attributes,
 *                 className: clsx(getSlateClass(plugin?.node.type), className) }
 *
 * And the alternative — raw attribute passthrough via
 * `node.dangerouslyAllowAttributes: ['class']` — forwards the HTML attribute
 * name `class` verbatim (not React's `className`), which React's static
 * markup renderer does NOT translate; it instead emits a second, duplicate,
 * invalid `class="..."` attribute in the HTML string alongside the
 * framework's own `class="slate-<type>"`. Neither is a working "config
 * only" path.
 *
 * So this L1 tier is downgraded to what's actually achievable without
 * bespoke-element engineering: ONE generic, variant-blind static component
 * (~15 lines, shared by every unmatched tag) that reads back the captured
 * `element.attributes` and `element.tag`. It still requires writing (a tiny
 * amount of) component code — a real, reportable finding — but it is
 * type-agnostic: it has zero knowledge of chips/cards/resrows, unlike L2's
 * purpose-built `chip` element which understands the `chip-<variant>` class
 * convention as a structured field.
 */

function GenericStaticElement(props: any) {
  const { element, children, attributes } = props;
  const attrs = element.attributes ?? {};
  const tag = (element.tag as string) ?? (props.editor.api.isInline(element) ? "span" : "div");
  const style = attrs.style ? parseInlineStyle(attrs.style) : undefined;

  return (
    <SlateElement
      {...props}
      as={tag}
      className={attrs.class}
      style={style}
      attributes={{
        ...attributes,
        id: attrs.id,
        open: "open" in attrs ? true : undefined,
      }}
    >
      {children}
    </SlateElement>
  );
}

function parseInlineStyle(style: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of style.split(";")) {
    const idx = decl.indexOf(":");
    if (idx === -1) continue;
    const k = decl.slice(0, idx).trim();
    const v = decl.slice(idx + 1).trim();
    if (!k || !v) continue;
    // CSS custom properties (--foo) must NOT be camelCased — React/DOM keep
    // them verbatim. Everything else gets kebab->camel for React's style object.
    const key = k.startsWith("--") ? k : k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    out[key] = v;
  }
  return out;
}

const ATTRIBUTE_NAMES = ["class", "style", "id", "open"];

const BLOCK_TAGS = [
  "DIV",
  "SECTION",
  "ARTICLE",
  "ASIDE",
  "HEADER",
  "FOOTER",
  "NAV",
  "DETAILS",
  "SUMMARY",
];

const INLINE_TAGS = ["SPAN"];

export const GenericBlockPlugin = createTSlatePlugin({
  key: "generic-block",
  node: { isElement: true },
  parsers: {
    html: {
      deserializer: {
        rules: [{ validNodeName: BLOCK_TAGS }],
        attributeNames: ATTRIBUTE_NAMES,
        parse: ({ element, type }) => ({
          type,
          tag: element.tagName.toLowerCase(),
        }),
      },
    },
  },
  render: { as: "div", node: GenericStaticElement },
});

export const GenericInlinePlugin = createTSlatePlugin({
  key: "generic-inline",
  node: { isElement: true, isInline: true },
  parsers: {
    html: {
      deserializer: {
        rules: [{ validNodeName: INLINE_TAGS }],
        attributeNames: ATTRIBUTE_NAMES,
        parse: ({ element, type }) => ({
          type,
          tag: element.tagName.toLowerCase(),
        }),
      },
    },
  },
  render: { as: "span", node: GenericStaticElement },
});
