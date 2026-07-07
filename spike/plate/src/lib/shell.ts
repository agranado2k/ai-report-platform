import { JSDOM } from "jsdom";

export interface ShellParts {
  doctype: string;
  htmlOpenTag: string;
  head: string;
  bodyOpenTag: string;
  bodyCloseTag: string;
  htmlCloseTag: string;
}

export interface SplitResult {
  shell: ShellParts;
  body: string;
}

/**
 * Split a full self-contained report HTML document into:
 *  - the "presentation shell": <!doctype>, <html ...>, <head>...</head>
 *    (which carries the single bespoke <style> block), and the body's own
 *    open/close tags (with its attributes, e.g. any class on <body>).
 *  - the "editable body": innerHTML of <body> — this is what an editor
 *    round-trips through import -> edit -> export.
 */
export function splitShell(fullHtml: string): SplitResult {
  const dom = new JSDOM(fullHtml);
  const doc = dom.window.document;

  const doctype = doc.doctype
    ? `<!doctype ${doc.doctype.name}>`
    : "<!doctype html>";

  const htmlAttrs = Array.from(doc.documentElement.attributes)
    .map((a) => `${a.name}="${a.value}"`)
    .join(" ");
  const htmlOpenTag = `<html${htmlAttrs ? " " + htmlAttrs : ""}>`;

  const head = doc.head.outerHTML;

  const bodyAttrs = Array.from(doc.body.attributes)
    .map((a) => `${a.name}="${a.value}"`)
    .join(" ");
  const bodyOpenTag = `<body${bodyAttrs ? " " + bodyAttrs : ""}>`;

  const body = doc.body.innerHTML;

  return {
    shell: {
      doctype,
      htmlOpenTag,
      head,
      bodyOpenTag,
      bodyCloseTag: "</body>",
      htmlCloseTag: "</html>",
    },
    body,
  };
}

/** Re-inject an (edited/exported) body HTML string into the original shell. */
export function reinject(shell: ShellParts, body: string): string {
  return [
    shell.doctype,
    shell.htmlOpenTag,
    shell.head,
    shell.bodyOpenTag,
    body,
    shell.bodyCloseTag,
    shell.htmlCloseTag,
  ].join("\n");
}
