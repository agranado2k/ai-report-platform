/**
 * Presentation-shell / editable-body split.
 *
 * The fixture report is a single self-contained HTML document: a <head> with
 * a big inline <style> block, then a <body> whose innerHTML is the "content"
 * a user would actually want to edit in a rich-text editor. The editor never
 * needs to see the <style> block or the <body> tag's own attributes — it
 * only needs the inner HTML, and we re-inject the (possibly edited) inner
 * HTML back into the original shell to reconstitute a full document.
 *
 * This is pure string splitting (no DOM parsing) so it works headlessly in
 * plain Node/vitest without jsdom, and so it can't accidentally normalize/
 * mutate the shell (whitespace, attribute order, doctype casing, etc.).
 */

export interface Shell {
  /** Everything from the start of the document through the end of the opening <body ...> tag. */
  readonly pre: string
  /** Everything from the start of the closing </body> tag to the end of the document. */
  readonly post: string
}

export interface SplitResult {
  readonly shell: Shell
  readonly bodyHtml: string
}

const BODY_OPEN_RE = /<body[^>]*>/i

/**
 * Split a full HTML document string into the presentation shell and the
 * editable body HTML (the body's innerHTML).
 */
export function splitDocument(html: string): SplitResult {
  const openMatch = BODY_OPEN_RE.exec(html)
  if (!openMatch) {
    throw new Error('splitDocument: no <body> opening tag found')
  }
  const bodyOpenTag = openMatch[0]
  const bodyOpenIndex = openMatch.index
  const bodyContentStart = bodyOpenIndex + bodyOpenTag.length

  const bodyCloseIndex = html.lastIndexOf('</body>')
  if (bodyCloseIndex === -1) {
    throw new Error('splitDocument: no </body> closing tag found')
  }
  if (bodyCloseIndex < bodyContentStart) {
    throw new Error('splitDocument: </body> occurs before <body> content start')
  }

  const pre = html.slice(0, bodyContentStart)
  const bodyHtml = html.slice(bodyContentStart, bodyCloseIndex)
  const post = html.slice(bodyCloseIndex)

  return { shell: { pre, post }, bodyHtml }
}

/**
 * Re-inject a (possibly edited) body HTML string into the shell captured by
 * splitDocument, reconstituting a full HTML document string.
 */
export function reinject(shell: Shell, bodyHtml: string): string {
  return shell.pre + bodyHtml + shell.post
}
