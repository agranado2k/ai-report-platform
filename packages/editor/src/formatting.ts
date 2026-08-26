// The Selection toolbar's formatting seam (ticket #297): a pure reading of
// which formats the current selection carries, plus the toggle commands the
// toolbar's buttons dispatch. Pure state/transform code — no DOM, no
// EditorView — so it is node-tested (formatting.test.ts) like the rest of
// this package's ProseMirror wiring.
//
// The reading covers the FULL toolbar vocabulary now (strong/em/link marks,
// heading level, list kind) even though ticket #297 only wires the bold and
// italic buttons — the link (#299) and block-type (#300) tickets reuse this
// module rather than growing their own competing definition of "active".
//
// The commands are prosemirror-commands' own `toggleMark` against
// `reportSchema` — the SAME command `editorPlugins()` binds to Mod-b / Mod-i
// (editor-state.ts), so the toolbar and the keyboard can never disagree about
// what "toggle bold" means. The keymap itself is untouched.
import { reportSchema } from "arp-report-html";
import { toggleMark } from "prosemirror-commands";
import type { MarkType, ResolvedPos } from "prosemirror-model";
import type { Command, EditorState } from "prosemirror-state";

/** Look up a mark type `reportSchema` is known to define — throws loudly on a
 *  schema regression instead of silently binding `undefined` (same posture as
 *  editor-state.ts's keymap wiring). */
function requireMark(name: string): MarkType {
  const mark = reportSchema.marks[name];
  if (!mark) throw new Error(`reportSchema has no '${name}' mark`);
  return mark;
}

/** Same, for node types (heading / list nodes from prosemirror-schema-list). */
function requireNode(name: string) {
  const node = reportSchema.nodes[name];
  if (!node) throw new Error(`reportSchema has no '${name}' node`);
  return node;
}

export type ListKind = "bullet" | "ordered";

/** Which formats the current selection carries — the toolbar's active-state
 *  reading, recomputed on every selection report so the buttons stay live. */
export interface ActiveFormats {
  readonly strong: boolean;
  readonly em: boolean;
  readonly link: boolean;
  /** The uniform heading level under the selection (1–6), or `null` when the
   *  selection touches no heading or spans differing block types. */
  readonly headingLevel: number | null;
  /** The list kind enclosing the selection, or `null` outside any list (or
   *  when the selection's ends sit in lists of different kinds). */
  readonly listKind: ListKind | null;
}

/** The mark toggles the toolbar can dispatch this ticket (#297) — bold and
 *  italic. Link (#299) needs an href editing flow, not a plain toggle. */
export type ToggleableFormat = "strong" | "em";

/** ProseMirror's own "is this mark active here" convention (the one
 *  prosemirror-example-setup's menu uses, and the one `toggleMark` itself
 *  removes-vs-adds by): a cursor reads its stored/inherited marks; a range is
 *  active when the mark appears ANYWHERE in it — matching how a second toggle
 *  on that range would clear it. */
function markActive(state: EditorState, type: MarkType): boolean {
  const { from, $from, to, empty } = state.selection;
  if (empty) return Boolean(type.isInSet(state.storedMarks ?? $from.marks()));
  return state.doc.rangeHasMark(from, to, type);
}

/** The single heading level every textblock the selection touches agrees on,
 *  or `null` (no heading touched, or mixed block types — a mixed selection
 *  has no honest "active" level to light up). */
function uniformHeadingLevel(state: EditorState): number | null {
  const heading = requireNode("heading");
  const { from, to } = state.selection;
  // `undefined` = no textblock seen yet; `null` = mixed or non-heading.
  let level: number | null | undefined;
  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isTextblock) return true; // descend
    const own = node.type === heading ? (node.attrs.level as number) : null;
    level = level === undefined || level === own ? own : null;
    return false; // a textblock has no nested textblocks
  });
  return level ?? null;
}

/** The NEAREST enclosing list's kind at a position, or `null` outside any
 *  list. Nearest-wins is the right reading for nested lists: the button
 *  should reflect the list the caret is actually typing into. */
function listKindAt($pos: ResolvedPos): ListKind | null {
  const bullet = requireNode("bullet_list");
  const ordered = requireNode("ordered_list");
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);
    if (node.type === bullet) return "bullet";
    if (node.type === ordered) return "ordered";
  }
  return null;
}

/** The list kind the selection sits in — both ends must agree; a selection
 *  straddling differently-kinded lists reads as `null`. */
function uniformListKind(state: EditorState): ListKind | null {
  const { $from, $to } = state.selection;
  const fromKind = listKindAt($from);
  return fromKind === listKindAt($to) ? fromKind : null;
}

/** The toolbar's one active-state reading: which marks and block types the
 *  current selection carries. Pure and cheap — safe to recompute on every
 *  selection report. */
export function activeFormats(state: EditorState): ActiveFormats {
  return {
    strong: markActive(state, requireMark("strong")),
    em: markActive(state, requireMark("em")),
    link: markActive(state, requireMark("link")),
    headingLevel: uniformHeadingLevel(state),
    listKind: uniformListKind(state),
  };
}

/** The command a toolbar toggle dispatches — prosemirror-commands'
 *  `toggleMark`, exactly what Mod-b / Mod-i already run, so toolbar and
 *  keyboard stay one behavior. `toggleMark` preserves the selection, which is
 *  what lets toggles chain (bold then italic) without re-selecting. */
export function toggleFormatCommand(format: ToggleableFormat): Command {
  return toggleMark(requireMark(format));
}
