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
import { isDangerousUrl, reportSchema } from "arp-report-html";
import { toggleMark } from "prosemirror-commands";
import type { MarkType, NodeType, Node as PMNode, ResolvedPos } from "prosemirror-model";
import { liftListItem, wrapInList } from "prosemirror-schema-list";
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
  /** The active link's href — the link editor's pre-fill (ticket #299).
   *  Non-null exactly when a link mark is under the cursor or anywhere in the
   *  range (the FIRST one, for a range touching several); `link: true` with
   *  the href alongside is what turns the Link button into "edit". */
  readonly linkHref: string | null;
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

/** The href of the link mark the selection carries — same "cursor reads its
 *  stored/inherited marks; a range reads the first occurrence" convention as
 *  `markActive`, so `linkHref` is non-null whenever `link` reads true. */
function activeLinkHref(state: EditorState, type: MarkType): string | null {
  const { from, $from, to, empty } = state.selection;
  if (empty) {
    const mark = type.isInSet(state.storedMarks ?? $from.marks());
    return typeof mark?.attrs.href === "string" ? mark.attrs.href : null;
  }
  let href: string | null = null;
  state.doc.nodesBetween(from, to, (node) => {
    if (href !== null) return false;
    const mark = type.isInSet(node.marks);
    if (typeof mark?.attrs.href === "string") href = mark.attrs.href;
    return href === null;
  });
  return href;
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
    linkHref: activeLinkHref(state, requireMark("link")),
    headingLevel: uniformHeadingLevel(state),
    listKind: uniformListKind(state),
  };
}

/** The outcome of validating a URL the user typed into the toolbar's link
 *  editor (ticket #299). `ok: false` carries WHY, so the UI can phrase its
 *  feedback; `ok: true` carries the trimmed href to actually apply. */
export type LinkHrefValidation =
  | { readonly ok: true; readonly href: string }
  | { readonly ok: false; readonly reason: "empty" | "unsafe" };

/** Validate a link URL BEFORE any dispatch, so the UI can reject it with
 *  visible feedback while the document stays untouched (ticket #299).
 *
 *  The unsafe rule is `isDangerousUrl` from arp-report-html — the SAME
 *  predicate the schema's `withSafeHref` enforces at parse AND serialize time
 *  (and the one link-activation.ts already reuses for click-time gating) —
 *  never a second URL policy grown here. Anything this function accepts, the
 *  schema retains; anything it rejects, the schema would strip anyway. */
export function validateLinkHref(raw: string): LinkHrefValidation {
  const href = raw.trim();
  if (href.length === 0) return { ok: false, reason: "empty" };
  if (isDangerousUrl(href)) return { ok: false, reason: "unsafe" };
  return { ok: true, href };
}

/** The contiguous run of an unbroken `type` mark instance around `$pos`
 *  (prosemirror-utils' getMarkRange convention), or `null` when `$pos` sits
 *  in no such mark. Instance-equality (`mark.isInSet`) is deliberate: two
 *  ADJACENT links with different hrefs are different mark instances, so the
 *  extent never bleeds into a neighboring link. */
function markExtent($pos: ResolvedPos, type: MarkType): { from: number; to: number } | null {
  const { parent, parentOffset } = $pos;
  // `childAfter` reads the run the cursor is entering; at a run's very end it
  // returns the NEXT (unmarked) child, so fall back to the run just before.
  let child = parent.childAfter(parentOffset);
  if (!child.node || !type.isInSet(child.node.marks)) {
    if (parentOffset === 0) return null;
    child = parent.childBefore(parentOffset);
  }
  if (!child.node) return null;
  const mark = type.isInSet(child.node.marks);
  if (!mark) return null;

  let startIndex = child.index;
  let from = $pos.start() + child.offset;
  let endIndex = child.index + 1;
  let to = from + child.node.nodeSize;
  while (startIndex > 0 && mark.isInSet(parent.child(startIndex - 1).marks)) {
    startIndex -= 1;
    from -= parent.child(startIndex).nodeSize;
  }
  while (endIndex < parent.childCount && mark.isInSet(parent.child(endIndex).marks)) {
    to += parent.child(endIndex).nodeSize;
    endIndex += 1;
  }
  return { from, to };
}

/** The range a link apply/remove operates on: the selection, with each end
 *  widened to the full extent of any link it touches — so editing from a
 *  cursor (or a partial selection) inside a link rewrites/removes the WHOLE
 *  link instead of splitting it into fragments with differing hrefs. `null`
 *  when there is nothing to operate on (a cursor outside any link). */
function linkCommandRange(state: EditorState, type: MarkType): { from: number; to: number } | null {
  const { from, to, $from, $to, empty } = state.selection;
  const fromExtent = markExtent($from, type);
  const toExtent = markExtent($to, type);
  if (empty && !fromExtent) return null;
  return {
    from: Math.min(from, fromExtent?.from ?? from),
    to: Math.max(to, toExtent?.to ?? to),
  };
}

/** The command the toolbar's link editor dispatches on Apply (ticket #299):
 *  wrap the selection (widened per `linkCommandRange`, so editing an existing
 *  link rewrites it whole) in a link mark carrying `href`.
 *
 *  Returns `false` — dispatching NOTHING, document untouched — for an href
 *  `validateLinkHref` rejects (the schema-shared safety rule; the UI shows
 *  feedback from the same predicate before ever building this command, and
 *  this second check makes the command safe even if a caller skips that) and
 *  for a collapsed selection outside any link (nothing to wrap). The other
 *  link attrs (title/target/rel/class/style) take their schema defaults; the
 *  schema's own `withSafeHref`/`withLinkTargetRel` normalization still runs
 *  at serialize time as the outer belt. */
export function setLinkCommand(href: string): Command {
  return (state, dispatch) => {
    const validated = validateLinkHref(href);
    if (!validated.ok) return false;
    const link = requireMark("link");
    const range = linkCommandRange(state, link);
    if (!range || range.from === range.to) return false;
    if (dispatch) {
      dispatch(state.tr.addMark(range.from, range.to, link.create({ href: validated.href })));
    }
    return true;
  };
}

/** The command the link editor's Remove dispatches: strip the link mark from
 *  the selection, widened to full link extents (`linkCommandRange`) so a
 *  cursor inside a link removes the whole link. `false` when the range
 *  carries no link at all — nothing to remove, nothing dispatched. */
export function removeLinkCommand(): Command {
  return (state, dispatch) => {
    const link = requireMark("link");
    const range = linkCommandRange(state, link);
    if (!range || !state.doc.rangeHasMark(range.from, range.to, link)) return false;
    if (dispatch) {
      dispatch(state.tr.removeMark(range.from, range.to, link));
    }
    return true;
  };
}

/** The command a toolbar toggle dispatches — prosemirror-commands'
 *  `toggleMark`, exactly what Mod-b / Mod-i already run, so toolbar and
 *  keyboard stay one behavior. `toggleMark` preserves the selection, which is
 *  what lets toggles chain (bold then italic) without re-selecting. */
export function toggleFormatCommand(format: ToggleableFormat): Command {
  return toggleMark(requireMark(format));
}

/** The heading levels the toolbar exposes (ticket #300). The schema itself
 *  parses/retains `<h1>`–`<h6>` (prosemirror-schema-basic's heading node), but
 *  the PRD scopes "heading levels" and the toolbar convention is a small set —
 *  so the command vocabulary is 1–3. `activeFormats().headingLevel` still
 *  reports 4–6 (as a number) so a deeper heading simply lights no button.
 *  Widen this union if the toolbar ever grows more levels. */
export type HeadingLevel = 1 | 2 | 3;

/** The retained presentation attrs (`class`/`style` via `withClassStyle`,
 *  `id` via `withId` — arp-report-html's schema) carried ACROSS a block-type
 *  conversion. Deliberate (ticket #300): `<h2 id="summary">` toggled back to
 *  a paragraph keeps `id="summary"` — a TOC's `#summary` anchor must survive
 *  a heading↔paragraph round-trip (ADR-0062 Amendment 3's "dead anchors are
 *  a product regression"), and bespoke `class`/`style` degrade to "preserved
 *  but uninterpreted" exactly as the schema's retention promises. Heading-ONLY
 *  attrs (`level`) and paragraph-only ones (`variant`, recomputed from `class`
 *  by the schema on the next parse) are dropped — `NodeType.create` ignores
 *  attr keys the target type does not define. */
function retainedBlockAttrs(node: PMNode): Record<string, unknown> {
  return {
    class: node.attrs.class ?? null,
    style: node.attrs.style ?? null,
    id: node.attrs.id ?? null,
  };
}

/** prosemirror-commands' `setBlockType` applicability + dispatch shape, with
 *  PER-NODE attrs (prosemirror-transform's attrs-function form) so each
 *  converted block keeps its own retained `class`/`style`/`id` — the static
 *  `Attrs` the prosemirror-commands version takes would stamp every block in
 *  a mixed selection with one shared attr set (or silently drop retention).
 *  Blocks whose parent cannot hold `type` are skipped by `tr.setBlockType`
 *  itself; the command returns `false` (nothing dispatched) when NO textblock
 *  in the selection can change. */
function setBlockTypeRetainingAttrs(
  type: NodeType,
  attrs: (node: PMNode) => Record<string, unknown>,
): Command {
  return (state, dispatch) => {
    let applicable = false;
    for (const range of state.selection.ranges) {
      if (applicable) break;
      state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos) => {
        if (applicable) return false;
        if (!node.isTextblock || node.hasMarkup(type, attrs(node))) return true;
        if (node.type === type) {
          applicable = true; // same type, different attrs (e.g. h3 → h2).
        } else {
          const $pos = state.doc.resolve(pos);
          const index = $pos.index();
          applicable = $pos.parent.canReplaceWith(index, index + 1, type);
        }
        return true;
      });
    }
    if (!applicable) return false;
    if (dispatch) {
      const tr = state.tr;
      for (const range of state.selection.ranges) {
        tr.setBlockType(range.$from.pos, range.$to.pos, type, attrs);
      }
      // Same dispatch shape as prosemirror-commands' setBlockType (and
      // toggleMark): scrollIntoView is a no-op for the visible selection the
      // toolbar operates on. `tr.setBlockType` maps the selection through, so
      // it survives the conversion — the toolbar's chaining contract.
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** The command a heading button dispatches (ticket #300): set every textblock
 *  in the selection to `<h{level}>` — or, when the selection ALREADY reads
 *  uniformly as that level (`activeFormats().headingLevel`, the same reading
 *  that lit the button), back to a paragraph. A mixed selection has no active
 *  level, so the button acts as "make it all this heading", never a blind
 *  per-block flip. Retained `class`/`style`/`id` survive in both directions
 *  (`retainedBlockAttrs`). */
export function toggleHeadingCommand(level: HeadingLevel): Command {
  return (state, dispatch) => {
    const heading = requireNode("heading");
    const paragraph = requireNode("paragraph");
    const active = uniformHeadingLevel(state) === level;
    const target = active ? paragraph : heading;
    return setBlockTypeRetainingAttrs(target, (node) =>
      active ? retainedBlockAttrs(node) : { ...retainedBlockAttrs(node), level },
    )(state, dispatch);
  };
}

/** The command a list button dispatches (ticket #300): wrap the selection in
 *  a bullet/ordered list — or, when the selection ALREADY sits in a list of
 *  that kind (`activeFormats().listKind`, nearest-enclosing-wins — the same
 *  reading that lit the button), LIFT the items out one level. Both halves
 *  are prosemirror-schema-list's own commands (`wrapInList` / `liftListItem`
 *  — the same library the schema's list nodes come from), never a bespoke
 *  transform:
 *  - lifting from a NESTED list lifts exactly once (into the parent list),
 *    never explodes the whole stack — repeat presses walk outward;
 *  - pressing the OTHER kind inside a list follows `wrapInList`'s own
 *    semantics: it nests a sublist where the schema allows one, and REFUSES
 *    (returns `false`, nothing dispatched) where it doesn't — e.g. at the
 *    top of an existing list. Kept deliberately: a convert-in-place would be
 *    a new transform this module would then own forever.
 *  Both commands preserve a mapped selection, so the toolbar's chaining
 *  contract holds here too. */
export function toggleListCommand(kind: ListKind): Command {
  const listNode = kind === "bullet" ? requireNode("bullet_list") : requireNode("ordered_list");
  return (state, dispatch) => {
    const active = uniformListKind(state) === kind;
    if (active) return liftListItem(requireNode("list_item"))(state, dispatch);
    return wrapInList(listNode)(state, dispatch);
  };
}
