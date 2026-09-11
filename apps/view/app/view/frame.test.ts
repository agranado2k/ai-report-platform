// The iframe contract (ADR-0089 §2), settled by the 2026-09-09 spike on
// Chromium 148. Every token here was verified in a real browser, several of
// them NEGATIVELY (drop `allow="fullscreen"` and requestFullscreen throws), so
// these assertions are the record of a measurement — not a restatement of an
// intention. The browser tier proves the framing half; this tier proves we
// emit exactly what was measured.
import { describe, expect, it } from "vitest";
import { REPORT_FRAME_ALLOW, REPORT_FRAME_SANDBOX, reportFrameSrc } from "./frame";

describe("the sandboxed report frame's attributes", () => {
  it("grants exactly the four sandbox tokens the spike settled on", () => {
    expect(REPORT_FRAME_SANDBOX.split(" ").sort()).toEqual([
      "allow-forms",
      "allow-popups",
      "allow-popups-to-escape-sandbox",
      "allow-scripts",
    ]);
  });

  it("WITHHOLDS allow-same-origin — this is the containment, not a detail", () => {
    // With it, the framed report shares the view origin: it could read the
    // chrome's DOM and (but for HttpOnly) its cookies. Without it the report
    // runs in an OPAQUE origin — the spike observed `document.cookie` and
    // `parent.document` both throwing SecurityError inside the frame.
    expect(REPORT_FRAME_SANDBOX).not.toContain("allow-same-origin");
  });

  it("WITHHOLDS every top-navigation token — a report cannot navigate the chrome away", () => {
    expect(REPORT_FRAME_SANDBOX).not.toContain("allow-top-navigation");
  });

  it("allows fullscreen — verified load-bearing, not decorative", () => {
    // Negative control from the spike: without this attribute
    // `requestFullscreen()` throws `TypeError: Disallowed by permissions
    // policy` and `document.fullscreenEnabled` is false. A deck that cannot
    // go fullscreen is not a deck.
    expect(REPORT_FRAME_ALLOW).toBe("fullscreen");
  });
});

describe("reportFrameSrc — the frame points at the CANONICAL url, with no token", () => {
  it("frames /<slug> itself", () => {
    expect(reportFrameSrc("abcde12345", "")).toBe("/abcde12345");
  });

  it("carries NO capability in the src — the cookie does that", () => {
    // ADR-0089 §2: the framed navigation is same-site, so it carries the
    // Path=/<slug> unlock cookie on its own. A token in the src would put a
    // capability in the report's own document.referrer and history.
    const src = reportFrameSrc("abcde12345", "#3");
    expect(src).not.toMatch(/[?&](access|et|oa)=/);
  });

  it("forwards the chrome page's hash so a deep link survives the frame", () => {
    expect(reportFrameSrc("abcde12345", "#3")).toBe("/abcde12345#3");
  });

  it("normalises a hash that arrives without its leading #", () => {
    expect(reportFrameSrc("abcde12345", "3")).toBe("/abcde12345#3");
  });

  it("ignores a bare '#' — an empty fragment is not a destination", () => {
    expect(reportFrameSrc("abcde12345", "#")).toBe("/abcde12345");
  });

  it("forwards a structured fragment VERBATIM — `#section/2` is a destination", () => {
    // A fragment is forwarded exactly as it arrived. It used to be stripped of
    // `/`, `?` and `\\` on the theory that those could redirect the frame; they
    // cannot — everything after the `#` is the fragment, so it can change
    // WHERE IN the document the frame lands but never WHICH document. The
    // stripping bought nothing and silently broke every report whose own
    // anchors are path-shaped, which is most generated decks and docs.
    expect(reportFrameSrc("abcde12345", "#section/2")).toBe("/abcde12345#section/2");
    expect(reportFrameSrc("abcde12345", "#a?b")).toBe("/abcde12345#a?b");
    expect(reportFrameSrc("abcde12345", "#a#b")).toBe("/abcde12345#a#b");
  });

  it("cannot be talked out of the report by a crafted hash", () => {
    // The hash is attacker-influenceable (it is whatever is in the address
    // bar) and it is concatenated into an iframe src, so the property that
    // matters is not "the string looks tidy" — it is that the URL the browser
    // RESOLVES still points at this report on this origin. Assert that, by
    // resolving it the way the browser would.
    for (const hostile of [
      "#/../other",
      "#?access=stolen",
      "#//evil.test",
      "#\\evil.test",
      "#../../../etc",
      "#a#b",
    ]) {
      const resolved = new URL(reportFrameSrc("abcde12345", hostile), "https://view.example.test");
      expect(resolved.origin).toBe("https://view.example.test");
      expect(resolved.pathname).toBe("/abcde12345");
      expect(resolved.search).toBe("");
    }
  });
});
