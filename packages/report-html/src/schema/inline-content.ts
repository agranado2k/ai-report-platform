import type { NodeSpec } from "prosemirror-model";

/**
 * Inline-only report row sub-containers (editor styling/structure fix,
 * follows PR #151's editor MVP): `rt` / `rd` / `rtags` / `chips` /
 * `block-label` — bespoke `<div class="…">` wrappers whose fixture content
 * is ALWAYS bare inline content (text and/or `chip` spans), never a nested
 * block element (verified against every occurrence in
 * fixtures/ai-readiness-report.html: 52× `rt`/`rd`/`rtags`, 25× `chips`, 14×
 * `block-label`).
 *
 * Without a dedicated spec these fall through to the generic attr-retention
 * catch-all (`htmlBlockNode`, `content: 'block*'`), which forces ProseMirror
 * to auto-wrap their bare inline content in a `<p>` (ADR-0062 §7's accepted
 * cost) — an extra DOM layer that breaks the fixture's CSS (the flex/gap
 * layouts on `.chips`/`.rtags`, the line-height/margin rules on `.rt`/`.rd`)
 * and shifts caret/selection placement inside what should be a single
 * inline run. `content: 'inline*'` accepts the bare inline content directly,
 * matching every fixture occurrence exactly and eliminating the extra `<p>`
 * for these five containers (see inline-content.test.ts and the updated
 * auto-wrap.test.ts).
 *
 * `role-head` and `rmeta` are deliberately NOT included here:
 * - `role-head` mixes inline content with a block `<h3>` in 4 of its 7
 *   fixture occurrences (e.g. `<span class="ref">PILLAR A</span><h3>Technical
 *   depth</h3>`), so it genuinely needs `content: 'block*'` and stays on the
 *   generic catch-all.
 * - `rmeta` is pure inline in every fixture occurrence too, but converting it
 *   was judged out of scope for this pass (not named in the task brief's
 *   list of containers to fix) — it stays on the generic catch-all, and (per
 *   the same judgment call) is not covered by the `>p` safety-net CSS either.
 *   A future pass can fold it in the same way if it turns out to matter.
 *
 * No explicit `parseDOM` priority is needed: `htmlBlockNode`'s catch-all
 * `div` rule is pinned at priority 40 (below the schema's default of 50)
 * specifically so any dedicated `div.<class>` rule — this one included —
 * wins without having to opt in (see the other report-blocks.ts nodes, none
 * of which set an explicit priority either).
 */
const INLINE_CONTENT_CLASSES = ["rt", "rd", "rtags", "chips", "block-label"] as const;

function inlineContentNode(className: (typeof INLINE_CONTENT_CLASSES)[number]): NodeSpec {
  return {
    group: "block",
    content: "inline*",
    parseDOM: [{ tag: `div.${className}` }],
    toDOM() {
      return ["div", { class: className }, 0];
    },
  };
}

export const rtNode: NodeSpec = inlineContentNode("rt");
export const rdNode: NodeSpec = inlineContentNode("rd");
export const rtagsNode: NodeSpec = inlineContentNode("rtags");
export const chipsNode: NodeSpec = inlineContentNode("chips");
export const blockLabelNode: NodeSpec = inlineContentNode("block-label");
