// Builds the HTML document loaded into the editor's sandboxed same-origin
// iframe (Fix 1 of the editor styling/structure fix). Uses a real, comment-aware
// HTML parser to insert the enforcing CSP `<meta>` (see `parseHtml` below —
// native `DOMParser` in the browser, injected `linkedom` in the unit tests) so a
// decoy `<head>` hidden in untrusted shell content can't fool where the CSP lands
// (the security-blocker fix). Unit-tested directly (iframe-document.test.ts) via
// the injected parser; the iframe mount itself (ReportEditor.tsx) is manual/e2e
// territory.
import type { Shell } from "arp-report-html";

/**
 * Comment-highlight decoration + auto-<p> safety-net CSS (Fix 2, and Fix 3's
 * companion), injected into the iframe's own <head> alongside the report's
 * own <style> block (from `shell.pre`) — NOT the dashboard's tailwind.css,
 * which never reaches inside the iframe; that isolation is exactly what Fix
 * 1 buys us. `.comment-highlight` styles the `Decoration.inline` spans
 * comment-decorations.ts already dispatches (previously dead: no CSS rule
 * for that class existed anywhere). The `>p` rules are a safety net for any
 * RESIDUAL auto-inserted `<p>` from a report container this pass didn't give
 * a dedicated `inline*` node (e.g. `rmeta`, `role-head` — see
 * packages/report-html/src/schema/inline-content.ts) — `display: contents`
 * makes that `<p>` invisible in layout while it still exists structurally.
 */
export const IFRAME_INJECTED_CSS = `
.comment-highlight {
  background: rgba(244, 201, 93, 0.28);
  box-shadow: inset 0 -2px rgba(244, 201, 93, 0.55);
  border-radius: 2px;
}
.rt > p, .rd > p, .rtags > p, .chips > p, .block-label > p,
.role-head > p, .rmeta > p {
  margin: 0;
  display: contents;
}
`.trim();

/**
 * SECURITY (ADR-0062 §9 amendment — editor styling/structure fix, hardened
 * post-review): the shell's own `<style>` (`shell.pre`) is UNTRUSTED, uploaded
 * CSS rendered on the app.<domain> origin, inside the sandboxed same-origin
 * iframe this document becomes (ReportEditor.tsx). This CSP is the enforcing
 * boundary against CSS-based exfiltration:
 * - `default-src 'none'` denies everything not explicitly allowed below —
 *   no script, no fetch/XHR/WebSocket/EventSource (nothing to exfiltrate
 *   through even if a future schema gap let something slip in), no nested
 *   frames, no objects/embeds.
 * - `style-src 'unsafe-inline'` (no `'self'`) is required for the report's
 *   own inline `<style>` block to render at all. `'self'` was DROPPED (was:
 *   `'self' 'unsafe-inline'`): reports are self-contained (no legitimate
 *   same-origin CSS reference), so `'self'` only ever bought a same-origin,
 *   cookie-bearing stylesheet-request-forgery surface against the app
 *   origin — never a real report asset. (Belt-and-braces, not the only
 *   defense — `sanitizeStyle` in packages/report-html already strips
 *   `@import`/`url(...)`/`image-set(...)`/`expression(...)` at the schema
 *   layer for any style value that round-trips through the editor.)
 * - `img-src data:` / `font-src data:` (no `'self'`, same rationale) allow
 *   inlined (`data:`) images/fonts the report might reference, while
 *   blocking both a remote AND a same-origin `url(...)` background-image
 *   beacon or `@font-face` fetch.
 * - `base-uri 'none'` blocks a rogue `<base href>` in the shell from
 *   rewriting how any relative URL resolves — not implied by `default-src`,
 *   so listed explicitly.
 * Delivered as a `<meta http-equiv>` tag rather than the non-standard
 * `iframe csp` attribute (proposed, never shipped broadly) — inserted as the
 * FIRST ELEMENT CHILD of the parsed `<head>`, before the report's own
 * `<style>`, so the policy is in force before any untrusted content is
 * parsed.
 *
 * SECURITY (blocker fix): this used to be inserted via `HEAD_OPEN_RE =
 * /<head[^>]*>/i` + `shell.pre.lastIndexOf("</head>")` — regex/indexOf on
 * `shell.pre`, which is FULLY ATTACKER-CONTROLLED (`splitShell` only
 * requires a later `<body …>` tag to exist; everything before it is
 * `shell.pre` verbatim). A decoy head-shaped string inside an HTML COMMENT
 * (e.g. `<!-- decoy <head foo> -->`) is invisible to a plain regex scan but
 * inert to a real parser — the regex would match the decoy as "the" head
 * open tag, splicing the CSP meta into dead comment text (never parsed, so
 * never enforced) while `lastIndexOf("</head>")` still finds the REAL
 * `</head>`, shipping the real head — carrying the attacker's exfiltrating
 * `<style>` — with no CSP at all. Fixed by using a real, comment-aware HTML
 * parser (see `parseHtml` below) instead of text search.
 */
const CSP_META =
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; ' +
  "style-src 'unsafe-inline'; img-src data:; font-src data:; " +
  "base-uri 'none'\">";

const INJECTED_STYLE_TAG = `<style>${IFRAME_INJECTED_CSS}</style>`;

/**
 * Parses an HTML string into a `Document`. Swappable so this module can be
 * unit-tested under vitest's plain `node` environment (this repo's only
 * unit-test environment, per the root `vitest.config.ts` — jsdom was removed
 * as un-shippable, ADR-0062 §2's `dom-environment.ts`) without adding a new
 * DOM-environment devDependency, and without shipping a heavy HTML-parsing
 * library into the CLIENT bundle for production.
 *
 * Production (`ReportEditor.tsx`, browser-only — `buildIframeDocument` is
 * called from a client mount `useEffect`, NOT during render, precisely so
 * `DOMParser` never runs during Remix SSR on the Node function) uses this
 * default: the browser's own native `DOMParser`, which is comment-aware (the
 * whole point of this fix), zero extra bytes (already built into every
 * browser), and never touched unless the caller omits the second argument — so
 * it's never evaluated, and therefore never referenced, under Node. The test
 * suite (`iframe-document.test.ts`) injects `linkedom`'s `parseHTML`
 * instead — a real, comment-aware HTML5 parser already a workspace
 * dependency (it's `arp-report-html`'s server-side DOM backend) — giving
 * full adversarial coverage without a jsdom/happy-dom devDependency or a
 * heavier client bundle.
 */
export type HtmlParser = (html: string) => Document;

function domParserParse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

/**
 * Build the full HTML document string loaded into the editor's sandboxed
 * iframe via `srcdoc` (Fix 1). `shell.pre` already carries the report's own
 * `<head>` (with its `<style>`) through the opening `<body …>` tag (see
 * packages/report-html/src/shell.ts); `shell.post` is `</body>…</html>`.
 * Concatenated as-is (no `bodyHtml` spliced between them, unlike
 * `reinjectShell` — which this function must NOT be confused with: the
 * SAVED artifact still round-trips through `reinjectShell`'s byte-exact
 * string concatenation, unchanged by this fix; only the editor's own render
 * surface re-parses) they produce a document whose `<body>` is EMPTY —
 * ProseMirror's `EditorView` mounts directly into that body element (`{
 * mount: iframeBody }`) and populates it itself (ReportEditor.tsx), so no
 * body markup needs to be serialized up front. The body's own
 * classes/attributes (from `shell.pre`'s literal `<body …>` tag) are
 * preserved untouched either way.
 *
 * Parses the concatenated `shell.pre + shell.post` with a real, comment-aware
 * HTML parser (`parseHtml`, see above) rather than the old regex/indexOf
 * approach, so a decoy head-shaped string hidden in an HTML comment or an
 * attribute value can never fool where the CSP meta lands. The CSP meta is
 * inserted as the parsed `<head>`'s first ELEMENT child (before the report's
 * own `<style>`); the highlight/safety-net `<style>` is appended as head's
 * last child (position doesn't matter for it — it's covered by the same
 * `'unsafe-inline'` as the report's own style block). The result is
 * rebuilt from the parsed `<head>` and `<body>` elements' own serialized
 * markup — not the parser's internal document tree shape — so a parser's
 * implied-tag placement (harmless-but-quirky for a genuinely headless input;
 * observed with `linkedom`, not spec behavior) never leaks into the output.
 */
export function buildIframeDocument(shell: Shell, parseHtml: HtmlParser = domParserParse): string {
  const doc = parseHtml(shell.pre + shell.post);
  const head = doc.head;
  const body = doc.body;
  // Defensive fallback: every real report shell carries a <head>...</head>
  // (see fixtures/ai-readiness-report.html), and any spec-compliant parser
  // (including the browser's real DOMParser) always implies a proper
  // <html><head>...</head><body>...</body></html> structure even when one
  // doesn't. `documentElement.tagName !== "HTML"` is the tell for a
  // degenerate parse (observed only for a bare `<body>` tag with literally
  // no preceding `<html>`/`<head>` token at all) — still produce a valid,
  // CSP-protected document rather than relying on that edge case's shape.
  if (doc.documentElement?.tagName !== "HTML" || !head || !body) {
    return `<!doctype html><html><head>${CSP_META}${INJECTED_STYLE_TAG}</head>${shell.pre}${shell.post}`;
  }
  head.insertAdjacentHTML("afterbegin", CSP_META);
  head.insertAdjacentHTML("beforeend", INJECTED_STYLE_TAG);
  return `<!doctype html><html>${head.outerHTML}${body.outerHTML}</html>`;
}
