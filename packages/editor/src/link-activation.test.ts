// Link activation rules (ADR-0062 Amendment 3). Pure decision logic — no
// mounted `EditorView`, no DOM — which is the whole reason the effects
// (open a tab / scroll to an anchor) are injected as props by `ReportEditor`
// rather than performed here.
import { parseBody } from "arp-report-html";
import { describe, expect, it } from "vitest";
import type { ClickPoint } from "./click-gesture";
import { createEditorState } from "./editor-state";
import {
  deferAnchorScroll,
  editorClickOutcome,
  type LinkLike,
  linkActivation,
  linkMarkAtPos,
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

describe("deferAnchorScroll — parent realm schedules, iframe realm is scrolled", () => {
  // The two realms are SEPARATE parameters on purpose. The scroll must be
  // deferred a frame (PM re-syncs the selection after a click and scrolls the
  // caret back), but the frame must be scheduled in the realm the handler
  // runs in — the PARENT. The editing iframe is `sandbox="allow-same-origin"`
  // with NO `allow-scripts`, i.e. scripting is DISABLED in that document, so
  // a callback handed to its `requestAnimationFrame` is at best
  // implementation-defined and at worst never runs — which presents as the
  // anchor click doing nothing at all. The ELEMENT, by contrast, only exists
  // in the iframe's document, so that is where the lookup must happen.
  const anchorSpy = () => {
    const calls: unknown[] = [];
    return { el: { scrollIntoView: (o?: unknown) => calls.push(o) }, calls };
  };

  it("does not scroll synchronously — it waits for the scheduled frame", () => {
    const { el, calls } = anchorSpy();
    let scheduled: (() => void) | null = null;
    deferAnchorScroll("summary", {
      schedule: (cb) => {
        scheduled = cb;
      },
      findAnchor: () => el,
    });
    expect(calls).toEqual([]); // nothing yet — the frame has not run
    (scheduled as unknown as () => void)();
    expect(calls).toEqual([{ behavior: "smooth" }]);
  });

  it("looks the anchor up in the iframe's own document, by the activation's targetId", () => {
    const { el, calls } = anchorSpy();
    const lookedUp: string[] = [];
    deferAnchorScroll("top-recommendation", {
      schedule: (cb) => cb(),
      findAnchor: (id) => {
        lookedUp.push(id);
        return el;
      },
    });
    expect(lookedUp).toEqual(["top-recommendation"]);
    expect(calls).toEqual([{ behavior: "smooth" }]);
  });

  it("is a no-op, never a throw, when the id matches nothing in the document", () => {
    expect(() =>
      deferAnchorScroll("missing", { schedule: (cb) => cb(), findAnchor: () => null }),
    ).not.toThrow();
    expect(() =>
      deferAnchorScroll("missing", { schedule: (cb) => cb(), findAnchor: () => undefined }),
    ).not.toThrow();
  });

  it("survives an element with no scrollIntoView (a realm-crossing shape mismatch)", () => {
    expect(() =>
      deferAnchorScroll("x", { schedule: (cb) => cb(), findAnchor: () => ({}) }),
    ).not.toThrow();
  });
});

describe("linkMarkAtPos — resolved through the ProseMirror model, not the DOM", () => {
  // The editing surface lives in an <iframe>, i.e. a different JS realm, so
  // `instanceof HTMLElement` / `closest("a")` are unreliable there. These
  // tests pin the model-based lookup that replaces them.
  const stateFor = (html: string) => createEditorState(parseBody(html));

  it("finds the link mark for a position inside the link text", () => {
    const state = stateFor('<p>before <a href="https://example.com/">link</a> after</p>');
    const linked = state.doc.textBetween(0, state.doc.content.size).indexOf("link");
    const mark = linkMarkAtPos(state, linked + 3); // inside "link"
    expect(mark?.attrs.href).toBe("https://example.com/");
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
