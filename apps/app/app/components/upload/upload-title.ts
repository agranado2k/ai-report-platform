// "Title defaults to the document's own <title>" (#337, report Z0W60dI8hu §03).
//
// A pure string function, deliberately NOT a DOM parse: it runs both on the
// client (prefill the Title field the moment a file is dropped or HTML is
// pasted) and on the server (the upload action derives it when the field is left
// blank, so the default still works with JavaScript off). A regex read of the
// first <title> is enough here — this only seeds a human-editable field, it is
// not a security boundary (the bytes are scanned and sanitised downstream,
// ADR-0012), so we never treat its output as trusted markup.

const TITLE_RE = /<title\b[^>]*>([\s\S]*?)<\/title>/i;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Decode the handful of HTML entities a real <title> commonly carries. Unknown
 *  entities are left verbatim — this seeds an editable field, not a renderer. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const codePoint =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

/**
 * The text of the document's first `<title>` element, entity-decoded and with
 * whitespace trimmed + collapsed — or `undefined` when there is no title, or it
 * is empty. Suitable as the DEFAULT for the upload Title field.
 */
export function deriveTitleFromHtml(html: string): string | undefined {
  const match = TITLE_RE.exec(html);
  if (!match) return undefined;
  const decoded = decodeEntities(match[1] ?? "");
  const collapsed = decoded.replace(/\s+/g, " ").trim();
  return collapsed || undefined;
}
