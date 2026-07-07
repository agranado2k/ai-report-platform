import type { DOMOutputSpec, MarkSpec, NodeSpec, ParseRule } from "prosemirror-model";

/**
 * Generic attr-retention rule (ADR-0062 §3): any class/attribute not claimed
 * by a named node/mark is preserved verbatim rather than dropped. This
 * helper wraps an existing node/mark spec (one that already has a `toDOM`
 * producing `[tag, attrs?, ...children]`) so parsing also captures `class`
 * and `style`, and `toDOM` re-emits them unchanged.
 */
export function withClassStyle<T extends NodeSpec | MarkSpec>(spec: T): T {
  const originalToDOM = spec.toDOM as ((n: never) => DOMOutputSpec) | undefined;
  if (!originalToDOM) return spec;
  return {
    ...spec,
    attrs: { ...(spec.attrs ?? {}), class: { default: null }, style: { default: null } },
    parseDOM: (spec.parseDOM ?? []).map((rule: ParseRule) => ({
      ...rule,
      getAttrs: (dom: HTMLElement) => {
        const base = rule.getAttrs ? rule.getAttrs(dom) : (rule.attrs ?? null);
        if (base === false) return false;
        return {
          ...(base || {}),
          class: dom.getAttribute ? dom.getAttribute("class") : null,
          style: dom.getAttribute ? dom.getAttribute("style") : null,
        };
      },
    })),
    toDOM: (nodeOrMark: never) =>
      mergeAttrsIntoOutputSpec(originalToDOM(nodeOrMark), {
        // biome-ignore lint/suspicious/noExplicitAny: nodeOrMark.attrs is typed `any` upstream.
        class: (nodeOrMark as any).attrs.class,
        // biome-ignore lint/suspicious/noExplicitAny: nodeOrMark.attrs is typed `any` upstream.
        style: (nodeOrMark as any).attrs.style,
      }),
  } as T;
}

/** Merge extra attributes into a DOMOutputSpec array of the form [tag, attrs?, ...children]. */
function mergeAttrsIntoOutputSpec(
  spec: DOMOutputSpec,
  extra: Record<string, unknown>,
): DOMOutputSpec {
  if (!Array.isArray(spec)) return spec;
  const [tag, ...rest] = spec as unknown[];
  const hasAttrsObj =
    rest.length > 0 && typeof rest[0] === "object" && rest[0] !== null && !Array.isArray(rest[0]);
  const attrs: Record<string, unknown> = hasAttrsObj
    ? { ...(rest[0] as Record<string, unknown>) }
    : {};
  const children = hasAttrsObj ? rest.slice(1) : rest;
  for (const [k, v] of Object.entries(extra)) {
    if (v != null && v !== "") attrs[k] = v;
  }
  return [tag, attrs, ...children] as unknown as DOMOutputSpec;
}
