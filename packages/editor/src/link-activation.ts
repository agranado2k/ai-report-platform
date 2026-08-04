// Link activation in the editing surface (ADR-0062 Amendment 3) — the
// headline half of the reported bug.
//
// WHY LINKS ARE INERT IN THE EDITOR BY CONSTRUCTION: `ReportEditor.tsx`
// mounts ProseMirror on the iframe's `<body>` with no `editable` prop, so
// PM's default `editable: true` applies and the body is `contenteditable`.
// Browsers never activate an anchor inside a contenteditable region — a
// click just places a caret. That is a deliberate browser behavior, not
// something the schema, the comment decorations, or the sandbox tokens
// caused, and it is why nothing short of handling the click ourselves fixes
// it. (The viewer's headers were empirically PROVEN not to be the cause: a
// real-browser reproduction under the byte-identical production sandbox CSP
// activated fragment links, self-navigation, and `target="_blank"` fine.)
//
// This module is the pure decision half — no DOM, no side effects — so the
// whole rule set is unit-testable without a mounted `EditorView`. The
// effects (open a tab / scroll to an anchor) are injected as props by the
// caller.
import { isDangerousUrl } from "arp-report-html";
import type { Mark } from "prosemirror-model";
import type { EditorState } from "prosemirror-state";
import { type ClickPoint, isClickNotDrag } from "./click-gesture";

/** What a click on a link should do, or `null` for "not a link activation". */
export type LinkActivation =
  | { readonly kind: "anchor"; readonly targetId: string }
  | { readonly kind: "external"; readonly url: string };

/** The only shape this module needs from a link mark — deliberately not
 *  ProseMirror's `Mark`, so the rules can be tested against plain objects. */
export interface LinkLike {
  readonly attrs: { readonly href?: unknown };
}

export interface LinkActivationInput {
  /** The link mark under the click, from `linkMarkAtPos` — `null` when the
   *  click did not land on a link. */
  readonly link: LinkLike | null;
  /** The tracked `mousedown` point, or `null` if none was seen. */
  readonly down: ClickPoint | null;
  /** The `click` point. */
  readonly up: ClickPoint;
  /** Alt/Option held — the deliberate suppression escape hatch. */
  readonly altKey: boolean;
}

/**
 * Find the `link` mark at a document position, using ProseMirror's own model.
 *
 * NOT `event.target.closest("a")`: the editor renders inside an `<iframe>`,
 * which is a DIFFERENT JavaScript realm. `instanceof Node` / `instanceof
 * HTMLElement` are `false` for nodes from that realm when tested against the
 * parent's constructors, so realm-crossing DOM introspection is a subtly
 * broken foundation to build on. The document model has no such problem —
 * the position from `posAtCoords` and the marks at it are plain data.
 *
 * Consults three mark sets, in order: the marks AT the position, then the
 * node BEFORE it, then the node after.
 *
 * The nodeBefore/nodeAfter legs are not belt-and-braces — they are required.
 * `link` is declared `inclusive: false` (prosemirror-schema-basic), which
 * makes `$pos.marks()` DELIBERATELY drop the link at its trailing boundary:
 * that method answers "what marks would typing here inherit", and typing just
 * past a link must not extend it. But `posAtCoords` lands on exactly that
 * boundary whenever the user clicks the right-hand half of a link's last
 * character, so a lookup built on `marks()` alone silently fails to activate
 * clicks near the end of every link.
 */
export function linkMarkAtPos(state: EditorState, pos: number): Mark | null {
  const linkType = state.schema.marks.link;
  if (!linkType) return null;
  let at: readonly Mark[];
  let before: readonly Mark[];
  let after: readonly Mark[];
  try {
    const $pos = state.doc.resolve(pos);
    at = $pos.marks();
    before = $pos.nodeBefore?.marks ?? [];
    after = $pos.nodeAfter?.marks ?? [];
  } catch {
    return null; // an out-of-range position is "no link", never a throw.
  }
  return linkType.isInSet(at) ?? linkType.isInSet(before) ?? linkType.isInSet(after) ?? null;
}

// Same normalization `isDangerousUrl` applies (packages/report-html
// schema/attrs.ts): browsers ignore control characters when parsing a URL
// scheme, so `jav\tascript:` is a live `javascript:` URL to a browser and
// must be to us too — matching on the raw string would be a classic filter
// bypass.
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — mirrors isDangerousUrl's own stripping so scheme matching sees what a browser sees.
const CONTROL_CHARS_RE = /[\x00-\x20\x7f]/g;

/** The schemes a click may follow. Everything else — including schemes that
 *  are merely unusual rather than known-dangerous — is refused: this is an
 *  allowlist, matching how the rest of the schema is built (ADR-0062 §3). */
const ACTIVATABLE_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:", "mailto:"]);

function schemeOf(href: string): string | null {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(href);
  return match?.[1] ? `${match[1].toLowerCase()}:` : null;
}

/**
 * Decide what a click on the editing surface should do.
 *
 * BEHAVIOR (operator's choice): a PLAIN click activates both in-page anchors
 * and external links; Alt/Option+click suppresses activation so the link text
 * can still be edited. This matches how the surface is actually used —
 * reading a report vastly outnumbers editing its link text — and inverting it
 * later is a one-line change.
 *
 * Refusals, in order: no link under the cursor; Alt held; the gesture was a
 * drag (selecting text across a link must never navigate); a non-string or
 * empty href; a dangerous scheme (`isDangerousUrl`, run as a redundant hard
 * gate even though `withSafeHref` should already have refused to retain such
 * an href at parse time — defense in depth for a doc built from a hostile
 * `_source.json` sidecar); a bare `#` with no target; and finally anything
 * that is not an allowlisted absolute scheme, which is what refuses
 * protocol-relative (`//evil.example`) and relative hrefs.
 */
export function linkActivation({
  link,
  down,
  up,
  altKey,
}: LinkActivationInput): LinkActivation | null {
  if (!link) return null;
  if (altKey) return null;
  if (!isClickNotDrag(down, up)) return null;

  const rawHref = link.attrs.href;
  if (typeof rawHref !== "string") return null;
  if (isDangerousUrl(rawHref)) return null;

  const href = rawHref.replace(CONTROL_CHARS_RE, "");
  if (href.length === 0) return null;

  if (href.startsWith("#")) {
    const targetId = href.slice(1);
    return targetId.length > 0 ? { kind: "anchor", targetId } : null;
  }

  const scheme = schemeOf(href);
  if (!scheme || !ACTIVATABLE_SCHEMES.has(scheme)) return null;
  return { kind: "external", url: href };
}

/** Everything a single click on the editing surface can mean. */
export type EditorClickOutcome =
  | LinkActivation
  | { readonly kind: "comment"; readonly commentId: string };

/**
 * Resolve the two click features against each other. LINK ACTIVATION WINS
 * over comment focus when both apply — a commented link is common (that is
 * often exactly what the reviewer is commenting ON), and following the link
 * is the more specific, more destructive-to-lose intent; the comment stays
 * one click away in the panel either way.
 *
 * Kept as a pure function rather than an `if` inside the DOM handler so the
 * precedence is pinned by a test instead of by handler statement order,
 * which is the kind of thing a later refactor reorders without noticing.
 */
export function editorClickOutcome(
  activation: LinkActivation | null,
  commentId: string | null,
): EditorClickOutcome | null {
  if (activation) return activation;
  return commentId ? { kind: "comment", commentId } : null;
}
