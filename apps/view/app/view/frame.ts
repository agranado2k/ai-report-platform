// The owner view's iframe contract (ADR-0089 §2). Pure, so the exact attribute
// set is unit-assertable and the browser tier can spend its budget on the
// things only a browser can answer.
//
// Every token below was verified in a real browser by the 2026-09-09 spike
// (Chromium 148.0.7778.96), several of them NEGATIVELY. These constants are
// therefore the record of a measurement, not a statement of intent — change
// one and you are contradicting an experiment, not a preference.

/**
 * The sandbox token set for the framed report.
 *
 * What is GRANTED: `allow-scripts` (the report is meant to run — this is the
 * whole point of the owner view), plus `allow-forms` / `allow-popups` /
 * `allow-popups-to-escape-sandbox`, which buy artifact parity: an ordinary
 * `target="_blank"` link in a report opens an ordinary page rather than
 * another sandboxed one.
 *
 * What is WITHHELD, and why it matters more:
 *
 * - **`allow-same-origin`.** Its absence puts the framed report in an OPAQUE
 *   origin. The spike observed `document.cookie` and `parent.document` both
 *   throwing `SecurityError` inside the frame. Granting it would hand a report
 *   served from this origin the run of the chrome page. `allow-scripts`
 *   WITHOUT `allow-same-origin` is the safe pairing — the script runs, and has
 *   no origin from which to reach anything.
 * - **every top-navigation token.** The framed report cannot navigate the
 *   chrome away, so it cannot redirect the owner to a phishing page and cannot
 *   replace the surface it is being judged on.
 *
 * This is one of two independent mechanisms: the report's own response still
 * carries the ADR-013 top-level `sandbox` CSP header, which drops it into an
 * opaque origin even with no iframe attribute at all.
 */
export const REPORT_FRAME_SANDBOX =
  "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox";

/** Load-bearing, and verified so. Negative control from the spike: without
 *  this attribute `requestFullscreen()` throws `TypeError: Disallowed by
 *  permissions policy` and `document.fullscreenEnabled` is `false`. A deck
 *  that cannot go fullscreen is not a deck. */
export const REPORT_FRAME_ALLOW = "fullscreen";

/**
 * The frame's `src`: the CANONICAL `/<slug>`, with the chrome page's own hash
 * forwarded so `/<slug>/view#3` lands on slide 3.
 *
 * There is deliberately **no token in the src**. The framed navigation is
 * same-site, so it carries the `Path=/<slug>` unlock cookie on its own (spike
 * Q1) — and a token here would land a capability in the report's own
 * `document.referrer` and in browser history.
 *
 * The hash is attacker-influenceable — it is whatever sits in the address bar
 * — and it is concatenated into an iframe `src`, so the question is what it
 * could do. The answer is: change where in the document the frame lands, and
 * nothing else. **Everything after the first `#` is the fragment**, by the URL
 * grammar itself, so a `/`, a `?`, a `\` or a second `#` inside it cannot move
 * the path, cannot add a query, and cannot reach another origin. It is
 * therefore forwarded **verbatim**, and the only thing dropped is an EMPTY
 * fragment, which is not a destination and would emit a bare trailing `#`.
 *
 * This used to strip `?`, `/`, `\` and `#`. That bought nothing the grammar
 * did not already guarantee, and it silently mangled legitimate anchors: a
 * report whose own headings are path-shaped (`#section/2`) — which is most
 * generated decks and docs — had its deep links quietly stop working, with no
 * error anywhere. `frame.test.ts` pins the real property by RESOLVING the
 * result the way a browser would and asserting the origin, path and query are
 * untouched, which is the guarantee that actually matters.
 */
export function reportFrameSrc(slug: string, hash: string): string {
  const fragment = hash.replace(/^#/, "");
  return fragment ? `/${slug}#${fragment}` : `/${slug}`;
}
