import { EDITOR_PANELS } from "arp-domain";
import { describe, expect, it } from "vitest";
import {
  closePanel,
  INITIAL_PANEL_STATE,
  initialPanelState,
  openPanel,
  PANEL_TABS,
  selectPanelTab,
  unresolvedCount,
} from "./panel";
import type { CommentWire } from "./wire-types";

function comment(overrides: Partial<CommentWire> = {}): CommentWire {
  const base: CommentWire = {
    object: "comment",
    id: "comment_1",
    report_id: "report_1",
    author_id: "user_1",
    author: { id: "user_1", email: null, name: null },
    parent_id: null,
    body: "hi",
    intent: "note",
    anchor: { version_pinned: { version_id: "version_1", text_quote: "q" } },
    edited_at: null,
    resolved_at: null,
    created_at: "2026-07-08T00:00:00.000Z",
    mode: "prod",
  };
  return { ...base, ...overrides };
}

describe("unresolvedCount", () => {
  it("is 0 for no comments", () => {
    expect(unresolvedCount([])).toBe(0);
  });

  it("counts only unresolved root comments", () => {
    const comments = [
      comment({ id: "a" }), // active root → counts
      comment({ id: "b", resolved_at: "2026-07-09T00:00:00.000Z" }), // resolved → skip
      comment({ id: "c", parent_id: "a" }), // reply → skip
      comment({ id: "d" }), // active root → counts
    ];
    expect(unresolvedCount(comments)).toBe(2);
  });

  it("does not count an unresolved reply on an active thread", () => {
    const comments = [comment({ id: "root" }), comment({ id: "reply", parent_id: "root" })];
    expect(unresolvedCount(comments)).toBe(1);
  });
});

describe("panel state", () => {
  it("starts closed on the comments tab", () => {
    expect(INITIAL_PANEL_STATE).toEqual({ open: false, tab: "comments" });
  });

  it("opens to the requested tab (closed → open)", () => {
    expect(openPanel("comments")).toEqual({ open: true, tab: "comments" });
    expect(openPanel("versions")).toEqual({ open: true, tab: "versions" });
  });

  it("switches the tab while open", () => {
    const open = openPanel("comments");
    expect(selectPanelTab(open, "versions")).toEqual({ open: true, tab: "versions" });
  });

  it("remembers the tab across close and reopen", () => {
    const onVersions = selectPanelTab(openPanel("versions"), "versions");
    const closed = closePanel(onVersions);
    expect(closed).toEqual({ open: false, tab: "versions" });
  });
});

// ── The URL entry point (#377) ───────────────────────────────────────────
describe("initialPanelState", () => {
  it("opens on versions for `?panel=versions` — the owner view's Versions action", () => {
    // The whole reason the ticket exists: the owner view's Versions action
    // lands on `/<slug>/edit`, and version history lives in this panel. Before
    // this, it arrived closed on the comments tab — one click short of the
    // thing the owner asked for, with nothing to explain why.
    expect(initialPanelState("versions")).toEqual({ open: true, tab: "versions" });
  });

  it("opens on comments for `?panel=comments`", () => {
    expect(initialPanelState("comments")).toEqual({ open: true, tab: "comments" });
  });

  it("falls back to the default for an absent param", () => {
    // `null` is what `URLSearchParams.get` returns for a param that is not
    // there, which is the overwhelmingly common case: every editor visit that
    // did not come through a deep link.
    expect(initialPanelState(null)).toEqual(INITIAL_PANEL_STATE);
  });

  it("falls back to the default for an unknown value, and never throws", () => {
    // The param is a HINT, not a capability (#377). It must not widen what the
    // route serves or who it serves it to, and a value nobody recognises is
    // not an error — it is just not a hint. Anything else would let a crafted
    // URL turn a typo into a 500 on an authenticated surface.
    for (const value of ["", "  ", "Versions", "settings", "__proto__", "1", "versions;drop"]) {
      expect(initialPanelState(value), value).toEqual(INITIAL_PANEL_STATE);
    }
  });

  it("is closed by default — the document stays the dominant element", () => {
    // Pins the fallback to the SHARED constant rather than to a copy of its
    // value, so a future change to the default cannot leave this function
    // disagreeing with the rest of the panel.
    expect(initialPanelState(null).open).toBe(false);
    expect(initialPanelState("nope")).toBe(INITIAL_PANEL_STATE);
  });

  it("its deep-linkable list IS the domain enum, member for member (#382)", () => {
    // The runtime half of the drift guard. `panel.ts` cannot value-import
    // `EDITOR_PANELS` (the arp-domain barrel drags `node:crypto` into the
    // browser bundle), so it declares an EXHAUSTIVE `Record<PanelTab, true>`
    // that fails the BUILD on a missing or extra key. This test is the other
    // half: it runs in node, imports the enum for real, and fails if the two
    // lists ever differ in content or order.
    expect([...PANEL_TABS]).toEqual([...EDITOR_PANELS]);
  });

  it.each(
    EDITOR_PANELS,
  )("honours %s — the editor's tabs and the hint the funnel carries are ONE enum (#382)", (panel) => {
    // The hint now crosses two origins and four hops before it arrives here:
    // owner view → the view gate's `/edit` funnel → the app's mint → the
    // gate's clean-URL 303 → this function. Every one of those validates
    // against `EDITOR_PANELS`. If this file kept a private list, a tab added
    // to one and not the other would deep-link from the address bar and die
    // on the click that actually produces it — which is #382 exactly, in a
    // new place.
    expect(initialPanelState(panel)).toEqual(openPanel(panel));
  });
});
