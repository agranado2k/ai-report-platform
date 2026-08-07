/**
 * Presentation-shell / editable-body split (ADR-0062 §2).
 *
 * A report document splits into a presentation shell (`<head>` + `<style>` +
 * the `<html>`/`<body>` tag's own attributes) and an editable body
 * (everything inside `<body>`). The shell is opaque to the editor: it is
 * never parsed into the ProseMirror schema, and is re-injected unmodified
 * on export.
 *
 * This is pure string splitting (no DOM parsing) so the shell can never be
 * accidentally normalized/mutated (whitespace, attribute order, doctype
 * casing, etc.) by round-tripping through a DOM.
 */

export interface Shell {
  /** Everything from the start of the document through the end of the opening <body ...> tag. */
  readonly pre: string;
  /** Everything from the start of the closing </body> tag to the end of the document. */
  readonly post: string;
}

export interface SplitShellResult {
  readonly shell: Shell;
  readonly bodyHtml: string;
}

const BODY_OPEN_RE = /<body[^>]*>/i;
const HEAD_CLOSE_RE = /<\/head\s*>/i;
const HTML_OPEN_RE = /<html[^>]*>/i;
const TRAILING_HTML_CLOSE_RE = /<\/html\s*>\s*$/i;

/**
 * The shell/body split for a document with NO `<body>` tag (ADR-0062
 * Amendment 4).
 *
 * Browsers synthesise a body for these, so they render perfectly; only the
 * editor used to reject them, which stranded every such report as permanently
 * uneditable. The split does not actually need the `<body>` tag — it needs the
 * boundary between presentation and content, and `</head>` marks that exactly
 * as well.
 *
 * The ordering below is the whole safety argument: `</head>` first, then the
 * `<html>` open tag, then "no wrapper at all". Getting it wrong in the other
 * direction — letting the `<head>` fall into the editable body — would feed the
 * `<style>` rules to the schema parser, and the first save would strip the
 * report's styling. Refusing to open a document is recoverable; silently
 * destroying its CSS on save is not.
 */
function splitBodylessDocument(html: string): SplitShellResult {
  const headClose = HEAD_CLOSE_RE.exec(html);
  const htmlOpen = headClose ? null : HTML_OPEN_RE.exec(html);
  const contentStart = headClose
    ? headClose.index + headClose[0].length
    : htmlOpen
      ? htmlOpen.index + htmlOpen[0].length
      : 0;

  // A trailing `</html>` is shell, not content — otherwise every save would
  // round-trip it through the schema parser, which has no node for it.
  const tail = TRAILING_HTML_CLOSE_RE.exec(html);
  const contentEnd = tail && tail.index >= contentStart ? tail.index : html.length;

  return {
    shell: { pre: html.slice(0, contentStart), post: html.slice(contentEnd) },
    bodyHtml: html.slice(contentStart, contentEnd),
  };
}

/**
 * Split a full HTML document string into the presentation shell and the
 * editable body HTML (the body's innerHTML).
 *
 * An explicit `<body>` always wins; a document without one is split by
 * `splitBodylessDocument` rather than rejected.
 */
export function splitShell(html: string): SplitShellResult {
  const openMatch = BODY_OPEN_RE.exec(html);
  if (!openMatch) {
    return splitBodylessDocument(html);
  }
  const bodyOpenTag = openMatch[0];
  const bodyOpenIndex = openMatch.index;
  const bodyContentStart = bodyOpenIndex + bodyOpenTag.length;

  const bodyCloseIndex = html.lastIndexOf("</body>");
  if (bodyCloseIndex === -1) {
    throw new Error("splitShell: no </body> closing tag found");
  }
  if (bodyCloseIndex < bodyContentStart) {
    throw new Error("splitShell: </body> occurs before <body> content start");
  }

  const pre = html.slice(0, bodyContentStart);
  const bodyHtml = html.slice(bodyContentStart, bodyCloseIndex);
  const post = html.slice(bodyCloseIndex);

  return { shell: { pre, post }, bodyHtml };
}

/**
 * Re-inject a (possibly edited) body HTML string into the shell captured by
 * splitShell, reconstituting a full HTML document string.
 */
export function reinjectShell(shell: Shell, bodyHtml: string): string {
  return shell.pre + bodyHtml + shell.post;
}
