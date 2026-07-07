import type { MarkSpec } from "prosemirror-model";

/**
 * `chip` mark (ADR-0062 §3) — a bespoke inline badge, `<span class="chip
 * chip-<variant>">`. The variant is the only attribute; `toDOM` reconstructs
 * the exact two-class `class` attribute from it, so the mark is lossless
 * for every fixture occurrence (239 in the reference fixture, across all 9
 * variants).
 */
export const CHIP_VARIANTS = [
  "cto",
  "staff",
  "pm",
  "now",
  "1yr",
  "5yr",
  "have",
  "sharpen",
  "build",
] as const;

export type ChipVariant = (typeof CHIP_VARIANTS)[number];

export const chipMark: MarkSpec = {
  attrs: { variant: {} },
  parseDOM: CHIP_VARIANTS.map((variant) => ({
    tag: `span.chip-${variant}`,
    attrs: { variant },
  })),
  toDOM(mark) {
    return ["span", { class: `chip chip-${mark.attrs.variant}` }, 0];
  },
};
