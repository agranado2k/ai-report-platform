// Builds the HTML document loaded into the editor's sandboxed same-origin
// iframe (Fix 1 of the editor styling/structure fix). Pure string building —
// no DOM — so it's unit-tested directly (iframe-document.test.ts) even
// though the iframe mount itself (ReportEditor.tsx) is manual/e2e territory.
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
.rt > p, .rd > p, .rtags > p, .chips > p, .block-label > p {
  margin: 0;
  display: contents;
}
`.trim();

/**
 * SECURITY (ADR-0062 §9 amendment — editor styling/structure fix): the
 * shell's own `<style>` (`shell.pre`) is UNTRUSTED, uploaded CSS rendered on
 * the app.<domain> origin, inside the sandboxed same-origin iframe this
 * document becomes (ReportEditor.tsx). This CSP is the enforcing boundary
 * against CSS-based exfiltration:
 * - `default-src 'none'` denies everything not explicitly allowed below —
 *   no script, no fetch/XHR/WebSocket/EventSource (nothing to exfiltrate
 *   through even if a future schema gap let something slip in), no nested
 *   frames, no objects/embeds.
 * - `style-src 'self' 'unsafe-inline'` is required for the report's own
 *   inline `<style>` block to render at all; `'self'` additionally permits a
 *   same-origin `@import`/stylesheet, never a remote one. (Belt-and-braces,
 *   not the only defense — `sanitizeStyle` in packages/report-html already
 *   strips `@import`/`url(...)`/`image-set(...)`/`expression(...)` at the
 *   schema layer for any style value that round-trips through the editor.)
 * - `img-src 'self' data:` / `font-src 'self' data:` allow same-origin and
 *   inlined (`data:`) images/fonts the report might reference, while
 *   blocking a `url(https://evil.example/pixel.png)` background-image
 *   beacon or a remote `@font-face` fetch.
 * - `base-uri 'none'` blocks a rogue `<base href>` in the shell from
 *   rewriting how any relative URL resolves — not implied by `default-src`,
 *   so listed explicitly.
 * Delivered as a `<meta http-equiv>` tag rather than the non-standard
 * `iframe csp` attribute (proposed, never shipped broadly) — inserted as the
 * FIRST child of `<head>`, before the report's own `<style>`, so the policy
 * is in force before any untrusted content is parsed.
 */
const CSP_META =
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; ' +
  "style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; " +
  "base-uri 'none'\">";

const INJECTED_STYLE_TAG = `<style>${IFRAME_INJECTED_CSS}</style>`;

const HEAD_OPEN_RE = /<head[^>]*>/i;

/**
 * Build the full HTML document string loaded into the editor's sandboxed
 * iframe via `srcdoc` (Fix 1). `shell.pre` already carries the report's own
 * `<head>` (with its `<style>`) through the opening `<body …>` tag (see
 * packages/report-html/src/shell.ts); `shell.post` is `</body>…</html>`.
 * Concatenated as-is (no `bodyHtml` spliced between them, unlike
 * `reinjectShell`) they produce a document whose `<body>` is EMPTY —
 * ProseMirror's `EditorView` mounts directly into that body element (`{
 * mount: iframeBody }`) and populates it itself (ReportEditor.tsx), so no
 * body markup needs to be serialized up front. The body's own
 * classes/attributes (from `shell.pre`'s literal `<body …>` tag) are
 * preserved untouched either way.
 *
 * The CSP meta tag is inserted as `<head>`'s first child (before the
 * report's own `<style>`); the highlight/safety-net `<style>` is appended
 * just before `</head>` (position doesn't matter for it — it's covered by
 * the same `'unsafe-inline'` as the report's own style block).
 */
export function buildIframeDocument(shell: Shell): string {
  const headOpenMatch = HEAD_OPEN_RE.exec(shell.pre);
  const headCloseIndex = shell.pre.lastIndexOf("</head>");
  if (!headOpenMatch || headCloseIndex === -1 || headCloseIndex < headOpenMatch.index) {
    // Defensive fallback: every real report shell carries a <head>...</head>
    // (see fixtures/ai-readiness-report.html), but if one somehow doesn't,
    // still produce a valid, CSP-protected document rather than throwing.
    return `<!doctype html><html><head>${CSP_META}${INJECTED_STYLE_TAG}</head>${shell.pre}${shell.post}`;
  }
  const afterHeadOpen = headOpenMatch.index + headOpenMatch[0].length;
  return (
    shell.pre.slice(0, afterHeadOpen) +
    CSP_META +
    shell.pre.slice(afterHeadOpen, headCloseIndex) +
    INJECTED_STYLE_TAG +
    shell.pre.slice(headCloseIndex) +
    shell.post
  );
}
