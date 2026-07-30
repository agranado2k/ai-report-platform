// Cross-inline-node selection-bleed trim (2026-07-29 dogfood paper cut #2).
//
// Double-click word selection in the browser operates on RENDERED text, so it
// extends into an adjacent inline node when no whitespace separates them in
// the doc model — a chip badge abutting paragraph text yields selections (and
// therefore stored anchors/quotes) like "ergonomicsAdopt" or
// "keeps highlightsA": 15+ chars spanning two nodes where the user meant one
// word. `trimSelectionBleed` cuts such a selection back to the boundary of
// the text node containing the MAJORITY of it.
//
// Deliberately conservative — it trims ONLY when ALL of these hold, and
// passes everything else through untouched:
//   * the selection covers exactly TWO text-node segments;
//   * both live under the SAME parent (a cross-block span is never a bleed);
//   * the junction between them has no whitespace on either side (a real
//     mid-sentence span across bold/link boundaries has a space somewhere);
//   * the minority side is a single whitespace-free fragment (a phrase that
//     happens to abut is a legitimate selection, not a double-click bleed);
//   * one side is strictly larger (an even split has no majority to keep).
// Genuine multi-node selections therefore survive verbatim.
import type { Node as PMNode } from "prosemirror-model";

interface TextSegment {
  /** Doc positions of the segment's INCLUDED portion (clamped to [from,to]). */
  readonly start: number;
  readonly end: number;
  /** The included portion's text. */
  readonly text: string;
  /** The text node's parent — used to rule out cross-block "bleeds". */
  readonly parent: PMNode | null;
}

function textSegments(doc: PMNode, from: number, to: number): TextSegment[] {
  const segments: TextSegment[] = [];
  doc.nodesBetween(from, to, (node, pos, parent) => {
    if (!node.isText || !node.text) return true;
    const start = Math.max(from, pos);
    const end = Math.min(to, pos + node.nodeSize);
    if (start < end) {
      segments.push({ start, end, text: node.text.slice(start - pos, end - pos), parent });
    }
    return true;
  });
  return segments;
}

const hasWhitespace = (s: string) => /\s/.test(s);

/** Trim a selection that BLEEDS across an inline-node boundary back to the
 *  node holding the majority of it (see the module doc comment for the exact
 *  conditions). Returns the input range unchanged whenever the shape is not
 *  the abutting-fragment bleed. */
export function trimSelectionBleed(
  doc: PMNode,
  from: number,
  to: number,
): { readonly from: number; readonly to: number } {
  const unchanged = { from, to };
  if (from >= to) return unchanged;

  const segments = textSegments(doc, from, to);
  if (segments.length !== 2) return unchanged;
  const [head, tail] = segments as [TextSegment, TextSegment];

  // Different parents means the selection crossed a block (or inline-container)
  // boundary — that's a deliberate structural selection, never a word bleed.
  if (head.parent !== tail.parent) return unchanged;

  // Whitespace at the junction marks a genuine cross-node sentence selection.
  const junctionBefore = head.text[head.text.length - 1] ?? "";
  const junctionAfter = tail.text[0] ?? "";
  if (hasWhitespace(junctionBefore) || hasWhitespace(junctionAfter)) return unchanged;

  const [minority, majority] = head.text.length < tail.text.length ? [head, tail] : [tail, head];
  if (minority.text.length === majority.text.length) return unchanged; // no majority
  // A multi-word minority is a real phrase the user swept over, not the
  // single-fragment spill a double-click produces.
  if (hasWhitespace(minority.text)) return unchanged;

  return majority === head ? { from, to: head.end } : { from: tail.start, to };
}
