// Link activation rules (ADR-0062 Amendment 3). Pure decision logic — no
// mounted `EditorView`, no DOM — which is the whole reason the effects
// (open a tab / scroll to an anchor) are injected as props by `ReportEditor`
// rather than performed here.
import { parseBody } from "arp-report-html";
import type { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import type { ClickPoint } from "./click-gesture";
import { createEditorState } from "./editor-state";
import {
  editorClickOutcome,
  type LinkLike,
  linkActivation,
  linkMarkAtPos,
  scrollAnchorIntoView,
} from "./link-activation";

const AT = (x: number, y: number): ClickPoint => ({ x, y });
const DOWN = AT(10, 10);
const linkTo = (href: unknown): LinkLike => ({ attrs: { href } });

/** A plain, non-dragged, non-modified click on `href`. */
const activate = (href: unknown) =>
  linkActivation({ link: linkTo(href), down: DOWN, up: AT(10, 10), altKey: false });

describe("linkActivation — href rules", () => {
  const cases: ReadonlyArray<readonly [string, unknown, ReturnType<typeof activate>]> = [
    ["in-page fragment", "#summary", { kind: "anchor", targetId: "summary" }],
    [
      "fragment with a dash",
      "#top-recommendation",
      { kind: "anchor", targetId: "top-recommendation" },
    ],
    ["bare # with no target", "#", null],
    ["https", "https://example.com/x", { kind: "external", url: "https://example.com/x" }],
    ["http", "http://example.com/", { kind: "external", url: "http://example.com/" }],
    ["UPPERCASE scheme", "HTTPS://example.com/", { kind: "external", url: "HTTPS://example.com/" }],
    ["mailto", "mailto:hi@example.com", { kind: "external", url: "mailto:hi@example.com" }],
    ["javascript:", "javascript:alert(1)", null],
    ["javascript: with an embedded control char", "jav\tascript:alert(1)", null],
    ["vbscript:", "vbscript:msgbox(1)", null],
    ["data:text/html", "data:text/html,<script>alert(1)</script>", null],
    ["protocol-relative", "//evil.example/x", null],
    ["relative path", "report.html", null],
    ["root-relative path", "/dashboard", null],
    ["empty string", "", null],
    ["whitespace only", "   ", null],
    ["a non-string href from a hostile sidecar", { toString: () => "https://x/" }, null],
    ["a null href", null, null],
    ["an unlisted scheme", "ftp://example.com/x", null],
    ["another unlisted scheme", "tel:+15551234", null],
  ];

  for (const [name, href, expected] of cases) {
    it(`${name} -> ${expected ? expected.kind : "no activation"}`, () => {
      expect(activate(href)).toEqual(expected);
    });
  }
});

describe("linkActivation — what is OPENED must be what the href says", () => {
  // The deny-check strips EVERY control char (`[\x00-\x20\x7f]`) so
  // `jav\tascript:` cannot smuggle a scheme past the allowlist. That form is
  // correct as a check and WRONG as a canonicalizer: a browser strips only
  // leading/trailing C0-or-space and interior tab/LF/CR — never an interior
  // space. Using the strict form as the thing we NAVIGATE to means the URL
  // the user is sent to differs from the href the check approved, which is a
  // deception primitive: `href="http s://evil.example"` 404s as a relative
  // path in the viewer but would open `https://evil.example` from `/edit`.
  it("REFUSES an href whose strict form and browser form disagree on the scheme", () => {
    // Strict-stripped this reads `https://evil.example` (allowlisted!); a
    // browser reads it as a relative path with a space in it. Never activate
    // a link the two readings do not agree on.
    expect(activate("http s://evil.example")).toBeNull();
    expect(activate("htt\u0020ps://evil.example")).toBeNull();
  });

  it("keeps an interior space in the opened URL rather than closing it up", () => {
    expect(activate("https://example.com/a b")).toEqual({
      kind: "external",
      url: "https://example.com/a b",
    });
  });

  it("removes tab/LF/CR from the opened URL — exactly what a browser removes", () => {
    expect(activate("https://example.com/a\nb")).toEqual({
      kind: "external",
      url: "https://example.com/ab",
    });
    expect(activate("https://example.com/a\tb\r")).toEqual({
      kind: "external",
      url: "https://example.com/ab",
    });
  });

  it("trims leading/trailing C0-or-space, which a browser also does", () => {
    expect(activate("  https://example.com/x  ")).toEqual({
      kind: "external",
      url: "https://example.com/x",
    });
    expect(activate("\u0000https://example.com/x")).toEqual({
      kind: "external",
      url: "https://example.com/x",
    });
  });

  it("scrolls to the id the author WROTE, spaces and all — `#a b` is not `#ab`", () => {
    expect(activate("#a b")).toEqual({ kind: "anchor", targetId: "a b" });
    expect(activate("#top recommendation")).toEqual({
      kind: "anchor",
      targetId: "top recommendation",
    });
  });

  it("still removes tab/LF/CR from a fragment, as a browser does", () => {
    expect(activate("#a\nb")).toEqual({ kind: "anchor", targetId: "ab" });
  });
});

describe("linkActivation — gesture rules", () => {
  it("does nothing when the click did not land on a link", () => {
    expect(linkActivation({ link: null, down: DOWN, up: AT(10, 10), altKey: false })).toBeNull();
  });

  it("ALT/Option+click suppresses activation — the escape hatch for editing link text", () => {
    const input = { link: linkTo("https://example.com/"), down: DOWN, up: AT(10, 10) };
    expect(linkActivation({ ...input, altKey: true })).toBeNull();
    // ...and the very same gesture without Alt DOES activate, so the test
    // pins the modifier as the cause rather than something else.
    expect(linkActivation({ ...input, altKey: false })).toEqual({
      kind: "external",
      url: "https://example.com/",
    });
  });

  it("a drag beyond the slop does not activate — selecting link text must not navigate", () => {
    const drag = (up: ClickPoint) =>
      linkActivation({ link: linkTo("#summary"), down: DOWN, up, altKey: false });
    expect(drag(AT(10, 10))).not.toBeNull(); // no movement
    expect(drag(AT(14, 14))).not.toBeNull(); // exactly at the slop
    expect(drag(AT(15, 10))).toBeNull(); // one px past, horizontally
    expect(drag(AT(10, 15))).toBeNull(); // one px past, vertically
  });

  it("a click with no tracked mousedown does not activate", () => {
    expect(
      linkActivation({ link: linkTo("#summary"), down: null, up: AT(10, 10), altKey: false }),
    ).toBeNull();
  });
});

describe("editorClickOutcome — link activation wins over comment focus", () => {
  const anchor = { kind: "anchor", targetId: "summary" } as const;

  it("follows the link when the click lands on BOTH a link and a comment highlight", () => {
    expect(editorClickOutcome(anchor, "comment-1")).toEqual(anchor);
  });

  it("focuses the comment when there is no link activation", () => {
    expect(editorClickOutcome(null, "comment-1")).toEqual({
      kind: "comment",
      commentId: "comment-1",
    });
  });

  it("does nothing when neither applies", () => {
    expect(editorClickOutcome(null, null)).toBeNull();
  });

  it("still follows the link when there is no comment", () => {
    expect(editorClickOutcome(anchor, null)).toEqual(anchor);
  });

  it("a SUPPRESSED link activation (Alt held) falls through to comment focus", () => {
    // The composed behavior the editor actually wires: Alt+click on a
    // commented link should not navigate, and the comment is then the only
    // remaining meaning of that click.
    const suppressed = linkActivation({
      link: linkTo("#summary"),
      down: DOWN,
      up: AT(10, 10),
      altKey: true,
    });
    expect(editorClickOutcome(suppressed, "comment-1")).toEqual({
      kind: "comment",
      commentId: "comment-1",
    });
  });
});

describe("scrollAnchorIntoView — the top-alignment pass, synchronous and answerable", () => {
  // WHY THIS IS A PLAIN FUNCTION OVER AN ELEMENT, and no longer a deferred
  // call over two injected dependencies (`schedule` + `findAnchor`).
  //
  // The operator's round-five production trace, taken with the spy on the
  // realm the call actually resolves through (the PARENT's
  // `Element.prototype` — see the realm note in link-activation.ts), is the
  // reason. Everything the editor does up to and including ProseMirror's own
  // caret reveal is byte-for-byte the same in production as in the browser
  // tier: the caret lands inside the anchor, and PM's `scrollRectIntoView`
  // issues one `window.scrollBy(0, 77.9)`. The top-alignment pass then does
  // not happen — no call on either prototype.
  //
  // The previous shape had THREE ways to not happen, and every one of them
  // was silent:
  //
  //  1. It ran downstream of `view.dispatch(...)` in the same call stack.
  //     prosemirror-view 1.42.0 puts NO try/catch around a
  //     `handleDOMEvents` handler (`runCustomHandler`, dist/index.js:3145),
  //     so anything that throws inside the dispatch — including a caller's
  //     own `onSelectionChange` — aborts the click handler after PM has
  //     already applied the caret and scrolled, and the alignment pass never
  //     runs. That is EXACTLY the production trace's shape.
  //  2. It waited on a `requestAnimationFrame` on the parent window. That
  //     frame's execution in the production page has never been observed.
  //  3. It re-looked-up the anchor by id a frame later, when the caller had
  //     just resolved that same element synchronously.
  //
  // None of the three is PROVEN to be the production cause; the cause is not
  // established. What is established is that all three sit inside the four
  // lines between the last thing production is seen to do and the thing it is
  // not seen to do, and that none of them leaves a trace. This shape has none
  // of them: the caller passes the element it already holds, the scroll is
  // issued in the same tick, and the function ANSWERS whether it scrolled.
  //
  // THE DEFERRAL HAD ALSO OUTLIVED ITS ARGUMENT. It was added (6f52bd0) when
  // the caret transaction did not exist and a frame's head start was being
  // used to out-run a competing scroll. `anchorScrollTransaction`
  // (editor-state.ts) replaced that strategy outright: the caret is put AT
  // the anchor, so any later reveal of it re-asserts the jump. Nothing is
  // being out-run, so there is nothing for a frame to buy.
  const anchorSpy = () => {
    const calls: unknown[] = [];
    return { el: { scrollIntoView: (o?: unknown) => calls.push(o) }, calls };
  };

  /** The one call shape this pass may make — see the "scrolls instantly"
   *  test below for the measurement that fixes it. */
  const INSTANT_TOP = { behavior: "instant", block: "start" };

  // THE CONTRACT THE OLD SHAPE INVERTED. It asserted "does not scroll
  // synchronously — it waits for the scheduled frame"; the deferral is now
  // the defect, so the assertion is its opposite and is stated first.
  it("scrolls in the caller's own tick — nothing is deferred to a later frame", () => {
    const { el, calls } = anchorSpy();
    scrollAnchorIntoView(el);
    expect(calls).toEqual([INSTANT_TOP]);
  });

  // A LATENT DEFECT THIS PASS ONCE HAD, AND THE REASON THE OPTION IS SPELLED
  // OUT TWICE.
  //
  // `behavior: "auto"` does NOT mean "instant". In CSSOM-View, `auto` means
  // "use the scrolling box's own CSS `scroll-behavior`" — it DEFERS to the
  // page. The editing surface renders the report's own shell CSS inside its
  // iframe, and a real generated report sets `html { scroll-behavior: smooth
  // }` (packages/report-html/src/fixtures/ai-readiness-report.html line 44),
  // so on such a document `auto` resolved to an animated, abortable scroll.
  // Measured in Chrome: a smooth scroll is abandoned permanently by ANY
  // competing scroll on the same box during its ~1.5s run. `instant` forces a
  // non-animated scroll whatever the CSS says.
  //
  // It is NOT the reported production failure — that was measured on a
  // document with no `scroll-behavior` rule at all, where `auto` already
  // resolved to instant. Do not re-attach this fix to that symptom.
  it("scrolls instantly, never as an abortable smooth animation", () => {
    const { el, calls } = anchorSpy();
    scrollAnchorIntoView(el);
    expect(calls).toEqual([INSTANT_TOP]);
  });

  it("never requests behavior 'auto' — that defers to the report's own CSS", () => {
    const { el, calls } = anchorSpy();
    scrollAnchorIntoView(el);
    const [options] = calls as ReadonlyArray<{ behavior?: string }>;
    expect(options?.behavior).toBe("instant");
  });

  // THE ANSWER IS THE POINT. The old shape returned `void` through three
  // optional chains (`findAnchor(id)?.scrollIntoView?.(...)`), so "the anchor
  // was not there" and "the anchor was scrolled" were indistinguishable to
  // every caller and to every instrument. A production round was spent on
  // that ambiguity.
  it("answers whether it actually scrolled", () => {
    const { el } = anchorSpy();
    expect(scrollAnchorIntoView(el)).toBe(true);
    expect(scrollAnchorIntoView(null)).toBe(false);
    expect(scrollAnchorIntoView(undefined)).toBe(false);
  });

  it("is a no-op, never a throw, when the anchor is missing from the document", () => {
    expect(() => scrollAnchorIntoView(null)).not.toThrow();
    expect(() => scrollAnchorIntoView(undefined)).not.toThrow();
  });

  it("survives an element with no scrollIntoView (a structural-type shape mismatch)", () => {
    expect(() => scrollAnchorIntoView({})).not.toThrow();
    expect(scrollAnchorIntoView({})).toBe(false);
  });
});

describe("linkMarkAtPos — resolved through the ProseMirror model, not the DOM", () => {
  // The editing surface lives in an <iframe>, i.e. a different JS realm, so
  // `instanceof HTMLElement` / `closest("a")` are unreliable there. These
  // tests pin the model-based lookup that replaces them.
  const stateFor = (html: string) => createEditorState(parseBody(html));

  /** The link's REAL document range, walked out of the doc. Derived rather
   *  than guessed: a text offset is not a document position (positions count
   *  node boundaries too), and an assertion that only passes because the two
   *  happen to coincide pins nothing. */
  const linkRange = (state: EditorState): { from: number; to: number } => {
    let range: { from: number; to: number } | null = null;
    state.doc.descendants((node, pos) => {
      if (node.isText && node.marks.some((mark) => mark.type.name === "link")) {
        range = { from: pos, to: pos + node.nodeSize };
      }
    });
    if (!range) throw new Error("fixture has no link mark");
    return range;
  };

  const SENTENCE = '<p>before <a href="https://example.com/">link</a> after</p>';

  it("finds the link mark for a position inside the link text", () => {
    const state = stateFor(SENTENCE);
    const { from, to } = linkRange(state);
    const middle = Math.floor((from + to) / 2);
    expect(middle).toBeGreaterThan(from);
    expect(middle).toBeLessThan(to);
    expect(linkMarkAtPos(state, middle)?.attrs.href).toBe("https://example.com/");
  });

  // BOTH BOUNDARIES, EXPLICITLY. `link` is `inclusive: false`, which makes
  // `$pos.marks()` deliberately drop the link at both of the link's own edges
  // — that method answers "what would typing here inherit", and typing at
  // either edge must not extend the link. But `posAtCoords` returns exactly
  // those positions whenever the user clicks the LEFT half of the link's first
  // character or the RIGHT half of its last, which is a routine click, not an
  // edge case. Without the nodeBefore/nodeAfter legs a click on either end
  // character of EVERY link silently does nothing.
  it("BOUNDARY: the left half of the FIRST character — recovered via nodeAfter", () => {
    const state = stateFor(SENTENCE);
    const { from } = linkRange(state);
    const $from = state.doc.resolve(from);
    expect($from.marks()).toEqual([]); // inclusive:false — marks() alone fails here
    expect($from.nodeBefore?.marks.some((m) => m.type.name === "link")).toBe(false);
    expect(linkMarkAtPos(state, from)?.attrs.href).toBe("https://example.com/");
  });

  it("BOUNDARY: the right half of the LAST character — recovered via nodeBefore", () => {
    const state = stateFor(SENTENCE);
    const { to } = linkRange(state);
    const $to = state.doc.resolve(to);
    expect($to.marks()).toEqual([]); // inclusive:false — marks() alone fails here
    expect($to.nodeAfter?.marks.some((m) => m.type.name === "link")).toBe(false);
    expect(linkMarkAtPos(state, to)?.attrs.href).toBe("https://example.com/");
  });

  it("BOUNDARY: a link that starts the paragraph — nodeAfter with nothing before it", () => {
    const state = stateFor('<p><a href="https://example.com/">link</a> after</p>');
    const { from } = linkRange(state);
    expect(linkMarkAtPos(state, from)?.attrs.href).toBe("https://example.com/");
  });

  it("returns null for a position in unlinked text", () => {
    const state = stateFor('<p>before <a href="https://example.com/">link</a> after</p>');
    expect(linkMarkAtPos(state, 2)).toBeNull();
  });

  it("returns null rather than throwing for an out-of-range position", () => {
    const state = stateFor("<p>hi</p>");
    expect(linkMarkAtPos(state, 99999)).toBeNull();
    expect(linkMarkAtPos(state, -1)).toBeNull();
  });

  it("carries target/rel through, so activation sees what the schema retained", () => {
    const state = stateFor('<p><a href="https://example.com/" target="_blank">x</a></p>');
    const mark = linkMarkAtPos(state, 2);
    expect(mark?.attrs.target).toBe("_blank");
    expect(mark?.attrs.rel).toContain("noopener");
  });
});
