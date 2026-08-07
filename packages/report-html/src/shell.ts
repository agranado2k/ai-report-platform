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

const TRAILING_HTML_CLOSE_RE = /<\/html\s*>\s*$/i;

/** Elements that legally live in (or wrap) the presentation head. Anything else
 *  is the first piece of CONTENT, and therefore marks the boundary. */
const SHELL_ELEMENTS = new Set([
  "html",
  "head",
  "meta",
  "title",
  "link",
  "base",
  "style",
  "script",
  "noscript",
  "template",
]);

/** Elements whose contents are RAWTEXT/RCDATA: markup inside them is TEXT, not
 *  markup. A `</head>` inside `<style>` does not end the head — only `</style>`
 *  ends a `<style>`. */
const RAWTEXT_ELEMENTS = new Set(["style", "script", "title", "textarea"]);

interface ScanResult {
  /** Offsets of the first REAL `<body …>` tag, if the document has one. */
  readonly body?: { readonly openStart: number; readonly openEnd: number };
  /** Offset where presentation ends and content begins, for body-less documents. */
  readonly contentStart: number;
}

/** Skip a start/end tag, honouring quoted attribute values so a `>` inside
 *  `content="</head>"` cannot end the tag early. Returns the offset just past
 *  the closing `>`, or the string length if the tag never closes. */
function skipTag(html: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i + 1;
    }
  }
  return html.length;
}

/**
 * Find the shell/content boundary by SCANNING the document rather than
 * regex-matching it (review of PR #255).
 *
 * A regex cannot do this job safely, and the failure is silent. `</head>` is an
 * OPTIONAL end tag in HTML5, so the common agent upload
 * `<html><head><style>…</style><h1>…` has no `</head>` at all — a naive scan
 * puts the entire head into the editable body, `parseBody` drops it, and the
 * first save writes the report back stripped of its content AND its CSS. The
 * round-trip stays byte-exact the whole time, so no round-trip test sees it.
 * The same regex is also blind to `</head>` appearing inside a comment, inside
 * a `<style>` (where it is text, not markup), or inside an attribute value.
 *
 * This is the same root cause Amendment 2 closed one layer up, so it is closed
 * the same way: understand comments and RAWTEXT instead of pattern-matching
 * over them.
 */
function scanDocument(html: string): ScanResult {
  // `</head>` is a CANDIDATE boundary, not a verdict: a document may close its
  // head and then still open an explicit <body>, which must win.
  let headClosedAt: number | null = null;
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) break;

    // Comments are text. A `</head>` or `<body>` inside one is not a tag.
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    // Doctype, CDATA, processing instructions.
    if (html.startsWith("<!", lt) || html.startsWith("<?", lt)) {
      i = skipTag(html, lt);
      continue;
    }

    const isEnd = html.startsWith("</", lt);
    const nameStart = lt + (isEnd ? 2 : 1);
    const nameMatch = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(html.slice(nameStart, nameStart + 32));
    if (!nameMatch) {
      // A bare `<` in text ("a < b"). Not markup — keep scanning past it.
      i = lt + 1;
      continue;
    }
    const name = nameMatch[0].toLowerCase();
    const tagEnd = skipTag(html, lt);

    if (isEnd) {
      // The explicit boundary, when the author wrote one.
      if (name === "head" && headClosedAt === null) headClosedAt = tagEnd;
      i = tagEnd;
      continue;
    }
    if (name === "body") return { body: { openStart: lt, openEnd: tagEnd }, contentStart: tagEnd };
    if (!SHELL_ELEMENTS.has(name)) {
      // The first real content element. Prefer an explicit `</head>` when the
      // author wrote one, so the whitespace between them stays in the shell.
      return { contentStart: headClosedAt ?? lt };
    }
    if (RAWTEXT_ELEMENTS.has(name)) {
      const close = html.toLowerCase().indexOf(`</${name}`, tagEnd);
      i = close === -1 ? html.length : skipTag(html, close);
      continue;
    }
    i = tagEnd;
  }
  // Head-only, or no markup at all: everything is shell.
  return { contentStart: headClosedAt ?? html.length };
}

/**
 * Split a full HTML document string into the presentation shell and the
 * editable body HTML (the body's innerHTML).
 *
 * An explicit `<body>` always wins; a document without one is split by
 * `splitBodylessDocument` rather than rejected.
 */
export function splitShell(html: string): SplitShellResult {
  const scan = scanDocument(html);

  if (!scan.body) {
    // Body-less: the boundary the scan found IS the split. A trailing `</html>`
    // is shell, not content — the schema parser has no node for it.
    const tail = TRAILING_HTML_CLOSE_RE.exec(html);
    const contentEnd = tail && tail.index >= scan.contentStart ? tail.index : html.length;
    return {
      shell: { pre: html.slice(0, scan.contentStart), post: html.slice(contentEnd) },
      bodyHtml: html.slice(scan.contentStart, contentEnd),
    };
  }

  const bodyContentStart = scan.body.openEnd;
  const bodyCloseIndex = html.toLowerCase().lastIndexOf("</body>");
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
