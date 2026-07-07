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

/**
 * Split a full HTML document string into the presentation shell and the
 * editable body HTML (the body's innerHTML).
 */
export function splitShell(html: string): SplitShellResult {
  const openMatch = BODY_OPEN_RE.exec(html);
  if (!openMatch) {
    throw new Error("splitShell: no <body> opening tag found");
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
