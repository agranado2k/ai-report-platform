// The containment attributes have to REACH the element (ADR-0089 §2, §6).
//
// `frame.test.ts` pins the constants byte for byte, and the browser tier proves
// what those bytes mean to Chromium. Neither of them notices if this component
// stops applying them: delete the `sandbox=` line and both stay green while the
// framed report gains the run of the chrome page. `ReportFrame` is the single
// consumer that turns the measurement into an attribute, so this is where that
// last link is pinned.
//
// The values are IMPORTED, never retyped — ADR-0088's rule, and the reason the
// assertions below are about *placement* rather than about the token set. What
// is asserted here is "the shipped contract is on the shipped element"; what
// the token set should BE is `frame.test.ts`'s question, answered once.
//
// apps/view has no jsdom tier (vitest `environment: "node"`), so this renders
// static SSR markup, exactly as `OwnerViewTopBar.test.ts` does. Effects do not
// run under `renderToStaticMarkup`, so the load-focus behaviour is deliberately
// out of scope here and belongs to a browser.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { REPORT_FRAME_ALLOW, REPORT_FRAME_SANDBOX } from "../frame";
import { ReportFrame, type ReportFrameProps } from "./ReportFrame";

function render(overrides: Partial<ReportFrameProps> = {}): string {
  const props: ReportFrameProps = {
    slug: "abcde12345",
    hash: "",
    title: "Q3 roadmap review",
    ...overrides,
  };
  return renderToStaticMarkup(createElement(ReportFrame, props));
}

describe("ReportFrame — the measured contract, applied", () => {
  it("puts the shipped sandbox token set on the iframe itself", () => {
    // Not "the constant has these tokens" (frame.test.ts owns that) but "the
    // constant is what the browser will read off this element".
    expect(render()).toContain(`sandbox="${REPORT_FRAME_SANDBOX}"`);
  });

  it("never emits allow-same-origin — the containment, read off the rendered markup", () => {
    // The whole security argument of ADR-0089 §6 reduces to this string being
    // absent from this element. With it, the framed report shares the view
    // origin and can read the chrome's DOM; without it, it runs in an opaque
    // origin. Asserted against the MARKUP rather than the constant so that a
    // component that reintroduced the token on its own — a second `sandbox`
    // prop, a spread, a "just for local dev" concatenation — is caught here
    // even while the constant stays clean.
    expect(render()).not.toContain("allow-same-origin");
  });

  it('carries allow="fullscreen" — the deck\'s own load-bearing permission', () => {
    expect(render()).toContain(`allow="${REPORT_FRAME_ALLOW}"`);
  });

  it("points at the CANONICAL /<slug>, with no capability in the src", () => {
    // ADR-0089 §2: the framed navigation is same-site and carries the
    // Path=/<slug> unlock cookie on its own. A token here would land a
    // capability in the report's own document.referrer and in history.
    const html = render();
    expect(html).toContain('src="/abcde12345"');
    expect(html).not.toMatch(/src="[^"]*[?&](access|et|oa)=/);
  });

  it("forwards the chrome page's hash into the frame, so #3 lands on slide 3", () => {
    // The deep-link half of the owner view: `/<slug>/view#3` has to reach the
    // framed deck, which only happens if the hash survives into this `src`.
    // NOTE: this covers hash FORWARDING only. Hash *adoption* on mount, the
    // `hashchange` listener and the `key={hash}` remount that makes a later
    // hash change re-navigate the frame all live in the `OwnerView` route
    // component, and are a browser-tier concern.
    expect(render({ hash: "#3" })).toContain('src="/abcde12345#3"');
  });

  it('announces the frame as the document it contains, not as "iframe"', () => {
    // The report's own title, so a screen-reader user reaching the frame is
    // told what is in it. Author-controlled, so it is an escaped attribute
    // value and never markup.
    expect(render({ title: 'A "quoted" title' })).toContain('title="A &quot;quoted&quot; title"');
  });
});
