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

// TWO FORMS OF THE SAME HREF, AND THEY DO DIFFERENT JOBS.
//
// The DENY form strips every control character, the same normalization
// `isDangerousUrl` applies (packages/report-html schema/attrs.ts): browsers
// ignore control characters when parsing a URL scheme, so `jav\tascript:` is a
// live `javascript:` URL to a browser and must be to us too — matching on the
// raw string would be a classic filter bypass.
//
// It is CORRECT as a check and WRONG as a canonicalizer. A browser strips only
// leading/trailing C0-or-space and interior tab/LF/CR; it never closes up an
// interior space. Navigating to the deny form would mean the URL we open
// differs from the href we checked — `href="http s://evil.example"` is a
// broken relative path to a browser (a 404 in the viewer) but reads as
// `https://evil.example` once the space is stripped, so opening the stripped
// form would send the user somewhere the report never linked to. Same class of
// bug on the fragment path: `#a b` must scroll to the id the author wrote, not
// to `#ab`.
//
// So: DENY-check the strict form, NAVIGATE the browser form, and refuse
// outright when the two readings disagree about the scheme.
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — mirrors isDangerousUrl's own stripping so scheme matching sees what a browser sees.
const CONTROL_CHARS_RE = /[\x00-\x20\x7f]/g;

/** The WHATWG URL parser's two cleanup steps, and nothing more: strip leading
 *  and trailing C0-control-or-space, then remove every ASCII tab/LF/CR from
 *  what remains. (`\x7f` is DEL, which is NOT a C0 control — a browser leaves
 *  it in place, so we do too.) */
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — this is the URL parser's own C0-control-or-space class.
const LEADING_TRAILING_C0_OR_SPACE_RE = /^[\x00-\x20]+|[\x00-\x20]+$/g;
const TAB_OR_NEWLINE_RE = /[\t\n\r]/g;

/** What a browser would actually open for this href. */
function browserForm(raw: string): string {
  return raw.replace(LEADING_TRAILING_C0_OR_SPACE_RE, "").replace(TAB_OR_NEWLINE_RE, "");
}

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
 * `_source.json` sidecar); a bare `#` with no target; anything that is not an
 * allowlisted absolute scheme, which is what refuses protocol-relative
 * (`//evil.example`) and relative hrefs; and any href whose strict
 * control-stripped reading and whose browser reading disagree (see the two
 * forms above — that is what refuses `http s://evil.example`).
 *
 * The returned `url` is the BROWSER form, so what gets opened is what the
 * href says; only the refusal decisions consult the strict form.
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

  const denyForm = rawHref.replace(CONTROL_CHARS_RE, "");
  const navigable = browserForm(rawHref);
  if (denyForm.length === 0 || navigable.length === 0) return null;

  if (denyForm.startsWith("#")) {
    // Both readings must agree this is a fragment before we treat it as one.
    if (!navigable.startsWith("#")) return null;
    const targetId = navigable.slice(1);
    return targetId.length > 0 ? { kind: "anchor", targetId } : null;
  }

  // BOTH forms must present an allowlisted absolute scheme. The deny form
  // closes `jav\tascript:`; the browser form is the one actually opened, so it
  // has to clear the allowlist in its own right — that is what refuses
  // `http s://evil.example`, which the deny form alone would wave through as
  // `https://evil.example`. Protocol-relative (`//evil.example`) and relative
  // hrefs have no scheme at all and are refused by the same two checks.
  const denyScheme = schemeOf(denyForm);
  if (!denyScheme || !ACTIVATABLE_SCHEMES.has(denyScheme)) return null;
  const navigableScheme = schemeOf(navigable);
  if (!navigableScheme || !ACTIVATABLE_SCHEMES.has(navigableScheme)) return null;
  return { kind: "external", url: navigable };
}

/** The only shape the anchor scroll needs from an element. Deliberately not
 *  `HTMLElement`: the element comes from the IFRAME's realm, where
 *  `instanceof HTMLElement` against the parent's constructor is `false`. */
export interface ScrollableLike {
  scrollIntoView?: (options?: {
    readonly behavior?: ScrollBehavior;
    readonly block?: ScrollLogicalPosition;
  }) => void;
}

export interface AnchorScrollDeps {
  /** Defer one animation frame, on the PARENT window's clock — the realm the
   *  click handler runs in. (The iframe's own `requestAnimationFrame` would
   *  also fire: `allow-scripts` governs script the DOCUMENT loads or
   *  contains, not a same-origin call made from the parent. Scheduling there
   *  would simply be the wrong clock for parent-realm code.) */
  readonly schedule: (callback: () => void) => void;
  /** Look the anchor up in the IFRAME's document — that is the only realm the
   *  element exists in. */
  readonly findAnchor: (targetId: string) => ScrollableLike | null | undefined;
}

/**
 * The DOM FALLBACK for an in-page anchor: scroll the element into view one
 * animation frame late.
 *
 * This is no longer the primary path. The primary path moves ProseMirror's
 * own selection to the anchor and lets PM scroll (`anchorScrollTransaction`,
 * editor-state.ts) — because a scroll performed BEHIND PM's back is undone by
 * PM's post-click caret reveal no matter how it is timed. This function is
 * what runs when the anchor's `id` sits on something PM cannot resolve to a
 * document position (an element in the shell, or a node the schema does not
 * own), where a plain DOM scroll is still better than nothing.
 *
 * INSTANT, NEVER SMOOTH — measured in Chrome, not reasoned about. A
 * `behavior: "smooth"` scroll is an abortable animation running for hundreds
 * of milliseconds (1.5s across a long report), and ANY competing scroll on the
 * same scrolling box during that window abandons it permanently, leaving the
 * box at the competitor's offset. Driving a 290px anchor scroll and then a
 * `scrollTo(0, 32)` produced a final `scrollY` of 32 for every competitor
 * arrival from 0ms to 600ms. `block: "start"` is stated rather than left to
 * the default so the alignment is part of the contract.
 *
 * `behavior: "instant"`, AND THE DIFFERENCE FROM `"auto"` IS REAL BUT IS NOT
 * THE REPORTED BUG. This call said `"auto"` for two releases, under a comment
 * asserting it was instant. It is not: in CSSOM-View `auto` means "use this
 * scrolling box's own CSS `scroll-behavior`", i.e. it DEFERS the decision to
 * the page. A report MAY set `html { scroll-behavior: smooth }` — one real
 * generated report does (packages/report-html/src/fixtures/
 * ai-readiness-report.html line 44) — and the editing surface renders the
 * report's own shell CSS inside its iframe, so on such a document this call
 * was resolving to an animated, abortable scroll. Measured in the browser tier
 * against that fixture: the jump still lands, ~1.5s later. `instant` forces a
 * non-animated scroll whatever the CSS says, which is what this call always
 * meant to do.
 *
 * WHAT IT DOES NOT EXPLAIN: the production anchor failure was measured on a
 * document with NO `scroll-behavior` rule anywhere, where `auto` already
 * resolved to instant. `tests/browser/harness/plain-report.html` reproduces
 * that document's CSS, and the anchor jump works on it both with `auto` and
 * with `instant`. So the cause of that failure is still not established — see
 * ADR-0062 Amendment 3 Decision 7. Do not re-attach this fix to that symptom.
 *
 * THE TWO REALMS ARE SEPARATE PARAMETERS ON PURPOSE. The frame is scheduled
 * in the realm this code actually runs in — the PARENT window. The ELEMENT,
 * conversely, only exists in the iframe's document, which is why the lookup is
 * the caller's job and crosses the boundary the other way.
 *
 * Scroll only; `location.hash` is never assigned. The iframe is a sandboxed
 * srcdoc document, so a hash assignment there is meaningless for the user's
 * URL bar and a navigation the sandbox has no reason to be asked to permit.
 */
export function deferAnchorScroll(targetId: string, deps: AnchorScrollDeps): void {
  deps.schedule(() => {
    deps.findAnchor(targetId)?.scrollIntoView?.({ behavior: "instant", block: "start" });
  });
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
