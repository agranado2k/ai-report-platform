/**
 * What the VIEWER will refuse to load — asked while the author still holds the
 * document (ticket #365, PRD #356).
 *
 * A report is served byte-for-byte on the view origin (ADR-0038) under the
 * enforcing CSP of ADR-0088, whose **Viewer CSP allowlist** is a deliberately
 * small set of hosts. A document that reaches for anything else renders
 * degraded — a dead chart, a fallback serif — and nothing has ever told its
 * author, who by then no longer has the document in hand. This module answers
 * that question at upload time.
 *
 * TWO RULES GOVERN EVERYTHING BELOW.
 *
 * 1. **The allowlist is read, never copied.** Every allowed host here comes out
 *    of `VIEW_CSP_ALLOWLIST` (ADR-0088), the same object `viewHeaders()` builds
 *    the policy from. A second list of hosts would agree on the day it was
 *    written and drift the first time the real one was widened — which is the
 *    whole reason ADR-0088 made it one exported constant.
 * 2. **This is a scan, never a fetch** (ADR-0069). The uploaded document is
 *    untrusted content. Nothing here dereferences a URL, resolves a host, or
 *    opens a socket; the function is synchronous precisely so that it *cannot*
 *    await I/O. It reads text and compares strings.
 *
 * It is also advisory only. Nothing here rejects an upload or changes a status
 * code — publishing a document that reaches for unpkg is legitimate, it just
 * will not render that part, and the author deserves to know.
 */

import { VIEW_CSP_ALLOWLIST } from "arp-headers/view";
import { parseHTML } from "linkedom";

/**
 * The CSP directive that governs a reference. Which one applies is a property
 * of HOW the document reaches for the resource, not of the host — a script CDN
 * is not an image source, and `img-src` stays pinned to the view origin because
 * a wildcard image source is an exfiltration channel (ADR-0088).
 */
export type BlockedDirective = "script-src" | "style-src" | "font-src" | "img-src" | "frame-src";

/** One external reference the viewer's CSP will block. */
export interface BlockedExternalResource {
  /** The URL exactly as the document writes it — the string the author can search for. */
  readonly url: string;
  /** The directive that governs this kind of reference. */
  readonly directive: BlockedDirective;
  /** The hosts that directive DOES permit — empty when it permits no external host. */
  readonly allowed: readonly string[];
}

/**
 * The allowed source list per directive, keyed off the one allowlist.
 *
 * `img-src` and `frame-src` are empty on purpose and that emptiness is a
 * decision, not an omission: ADR-0088 pins `img-src 'self' data: blob:` and
 * leaves frames to `default-src 'self'`. If the allowlist ever grows a
 * directive, this map is where it is admitted — one visible edit, reviewable as
 * the security decision it is.
 */
const ALLOWED_BY_DIRECTIVE = {
  "script-src": VIEW_CSP_ALLOWLIST.scriptSrc,
  "style-src": VIEW_CSP_ALLOWLIST.styleSrc,
  "font-src": VIEW_CSP_ALLOWLIST.fontSrc,
  "img-src": [],
  "frame-src": [],
} as const satisfies Record<BlockedDirective, readonly string[]>;

/** `rel` tokens that actually LOAD something, and the directive each loads under.
 *  `preconnect` / `dns-prefetch` / `canonical` open no resource, so they raise
 *  nothing — warning about them would be noise the author cannot act on. */
const LOADING_LINK_RELS: Record<string, BlockedDirective> = {
  stylesheet: "style-src",
  icon: "img-src",
  "shortcut icon": "img-src",
  "apple-touch-icon": "img-src",
};

/** Schemes that fetch nothing across the network, so the CSP host-source list
 *  never applies: the bytes are already in the document or in the page. */
const INERT_SCHEME = /^(?:data|blob|about|javascript|mailto|tel):/i;

/** What the scan needs to know about the deployment it is answering for. */
export interface ScanOptions {
  /**
   * The origin the report will be served from (`https://view.<domain>`), when
   * the deployment knows it. Every fetch directive in the ADR-0088 viewer
   * policy begins with `'self'`, so a reference written out in full against
   * this origin genuinely loads and must not be warned about.
   *
   * Optional because previews and dev leave `VIEW_ORIGIN` unset. Absent, the
   * scan says only what it can prove from the bytes: an absolute URL is
   * external. An advisory line nobody needed beats clearing a resource the
   * viewer will in fact refuse.
   */
  readonly viewOrigin?: string;
}

/**
 * Report every external reference in `html` that the viewer's CSP will block.
 *
 * Total by contract — malformed, truncated or hostile-looking bytes produce an
 * answer, never a throw, because the caller is an upload that must not fail for
 * asking a question.
 */
export function scanBlockedResources(
  html: string,
  options: ScanOptions = {},
): readonly BlockedExternalResource[] {
  const found: BlockedExternalResource[] = [];
  const seen = new Set<string>();
  // Normalised once: an unparseable configured origin matches nothing rather
  // than throwing on the write path.
  const selfOrigin = originOf(options.viewOrigin);

  const consider = (raw: string | null | undefined, directive: BlockedDirective): void => {
    const url = raw?.trim();
    if (!url) return; // `src=""` is the document itself
    if (!isExternal(url)) return; // relative, same-document, or inert scheme
    if (selfOrigin !== undefined && originOf(url) === selfOrigin) return; // 'self', written out in full
    if (isAllowed(url, ALLOWED_BY_DIRECTIVE[directive])) return;
    const key = `${directive} ${url}`;
    if (seen.has(key)) return; // one warning per distinct URL
    seen.add(key);
    found.push({ url, directive, allowed: ALLOWED_BY_DIRECTIVE[directive] });
  };

  let document: Document;
  try {
    document = parseHTML(html).document as unknown as Document;
  } catch {
    // linkedom is forgiving, but the contract is "always answers". A document
    // nobody can parse references nothing anybody can name.
    return [];
  }

  try {
    for (const el of document.querySelectorAll("script[src]")) {
      consider(el.getAttribute("src"), "script-src");
    }
    for (const el of document.querySelectorAll("link[href]")) {
      const directive = linkDirective(el.getAttribute("rel"), el.getAttribute("as"));
      if (directive) consider(el.getAttribute("href"), directive);
    }
    for (const el of document.querySelectorAll("img[src], img[srcset], source[srcset]")) {
      consider(el.getAttribute("src"), "img-src");
      for (const candidate of srcsetUrls(el.getAttribute("srcset"))) {
        consider(candidate, "img-src");
      }
    }
    for (const el of document.querySelectorAll("iframe[src]")) {
      consider(el.getAttribute("src"), "frame-src");
    }
    for (const el of document.querySelectorAll("style")) {
      for (const ref of cssReferences(el.textContent ?? "")) consider(ref.url, ref.directive);
    }
    for (const el of document.querySelectorAll("[style]")) {
      // A `style` attribute cannot carry `@font-face` or `@import`, so every
      // url() in one is a passive image source.
      for (const ref of cssReferences(el.getAttribute("style") ?? "")) consider(ref.url, "img-src");
    }
  } catch {
    // Partial results beat no results: whatever was already collected stands.
  }

  return found;
}

/** Which directive a `<link>` loads under, or `undefined` when it loads nothing. */
function linkDirective(rel: string | null, as: string | null): BlockedDirective | undefined {
  const tokens = (rel ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.includes("preload") || tokens.includes("modulepreload")) {
    // A preload's directive is whatever it is preloading FOR (`as`).
    switch ((as ?? "").toLowerCase()) {
      case "script":
        return "script-src";
      case "style":
        return "style-src";
      case "font":
        return "font-src";
      case "image":
        return "img-src";
      default:
        return undefined;
    }
  }
  for (const token of tokens) {
    const directive = LOADING_LINK_RELS[token];
    if (directive) return directive;
  }
  return undefined;
}

/** The URL of each candidate in a `srcset`, ignoring the density/width descriptors. */
function srcsetUrls(srcset: string | null): readonly string[] {
  if (!srcset) return [];
  return srcset
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0] ?? "")
    .filter(Boolean);
}

const FONT_FACE_RE = /@font-face\s*\{[^}]*\}/gi;
const IMPORT_STMT_RE = /@import[^;]*;?/gi;
/**
 * A `url()` reference. The length bound is a BACKTRACKING guard, not a URL
 * limit: without it, `url(` followed by a long unterminated tail makes the
 * engine retry from every position, and this runs over an untrusted document.
 * A 2KB asset URL is well past anything the viewer would load.
 */
const URL_RE = /url\(\s*["']?([^"')]{1,2048})["']?\s*\)/gi;
/** `@import "theme.css"` — the quoted form, which carries no `url()`. */
const BARE_IMPORT_RE = /@import\s+["']([^"']{1,2048})["']/i;

/**
 * Every external reference a stylesheet makes, with the directive it loads
 * under. A regex, not a CSS parser, and the trade is deliberate: this is
 * advisory output for a human or an agent to read, so a missed exotic form
 * costs a warning nobody got, while pulling a CSS parser into the upload path
 * would cost every upload.
 *
 * It works by CONSUMING the at-rules it understands, in order, so that each
 * `url()` is attributed exactly once and whatever survives is a plain image
 * source. That also keeps the whole pass LINEAR in the size of the stylesheet
 * — the document is untrusted (ADR-0069), so a scan whose cost is quadratic in
 * its input is a denial-of-service primitive on the upload path, not merely
 * slow.
 */
function cssReferences(css: string): readonly { url: string; directive: BlockedDirective }[] {
  const refs: { url: string; directive: BlockedDirective }[] = [];
  const collect = (text: string, directive: BlockedDirective): void => {
    for (const match of text.matchAll(URL_RE)) {
      if (match[1]) refs.push({ url: match[1].trim(), directive });
    }
  };

  // @font-face first: its url()s are font files, not images. A function
  // replacer over the global regex handles EVERY block including identical
  // repeats, which a string-needle removal would not.
  const withoutFontFaces = css.replace(FONT_FACE_RE, (block) => {
    collect(block, "font-src");
    return " ";
  });

  // @import next, consumed for the same reason — otherwise its url() would be
  // counted a second time below as an image.
  const remainder = withoutFontFaces.replace(IMPORT_STMT_RE, (statement) => {
    // `match` (not `test`) on purpose: on a /g regex it resets lastIndex, so
    // the shared module-level pattern cannot carry state into the next call.
    if (statement.match(URL_RE)) collect(statement, "style-src");
    else {
      const bare = BARE_IMPORT_RE.exec(statement);
      if (bare?.[1]) refs.push({ url: bare[1].trim(), directive: "style-src" });
    }
    return " ";
  });

  // Whatever url() survives both is a passive image source.
  collect(remainder, "img-src");
  return refs;
}

/**
 * Whether a reference leaves the view origin at all.
 *
 * Only an absolute URL with a host can: a relative path, a fragment (`#grad`,
 * which is also how SVG references its own gradients) and a bare query all
 * resolve to the viewer's own origin, which `'self'` already permits. `data:`
 * and the other inert schemes fetch nothing. None of them can be blocked, so
 * none of them is a warning.
 */
/**
 * An absolute URL as a user agent resolves it before matching it against CSP:
 * `.` and `..` segments collapsed (including their `%2e` spellings, which a
 * URL parser treats as dot segments too), default port dropped, fragment
 * discarded — CSP never matches on a fragment.
 *
 * Falls back to the string as written when it cannot be parsed. That is the
 * conservative direction: an unresolvable URL fails the prefix test and is
 * reported, rather than being cleared on a comparison nobody can trust.
 *
 * Parsing only, no dereference (ADR-0069).
 */
function resolvedForMatch(absolute: string): string {
  try {
    const parsed = new URL(absolute);
    return `${parsed.origin}${parsed.pathname}${parsed.search}`;
  } catch {
    return absolute;
  }
}

/**
 * The origin of an absolute reference, lowercased and port-normalised the way
 * a browser normalises one, or `undefined` when there is no origin to speak of.
 *
 * Parsing only — `new URL` resolves no host and opens no socket (ADR-0069).
 */
function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  // Protocol-relative resolves against the viewer's https origin.
  const absolute = url.startsWith("//") ? `https:${url}` : url;
  try {
    const origin = new URL(absolute).origin;
    // Opaque-origin schemes (`data:`, `blob:` in some engines) stringify to
    // "null"; two of those are not the same origin as each other.
    return origin === "null" ? undefined : origin;
  } catch {
    return undefined;
  }
}

function isExternal(url: string): boolean {
  if (url.startsWith("#") || url.startsWith("?")) return false;
  if (INERT_SCHEME.test(url)) return false;
  if (url.startsWith("//")) return true; // protocol-relative
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(url);
}

/**
 * Whether `url` matches one of an allowlist entry's sources, the way CSP
 * matches them: an entry is an origin, optionally with a path prefix
 * (`https://cdn.jsdelivr.net/npm/`), and a path prefix is load-bearing —
 * jsdelivr's `/npm/` is allowlisted and its `/gh/` is not.
 *
 * The URL is RESOLVED before the prefix is compared, because that is the order
 * a user agent works in: `/npm/../gh/x.js` is `/gh/x.js` by the time CSP sees
 * it, so an allowlist prefix a `..` segment walks out of does not cover it.
 */
function isAllowed(url: string, allowed: readonly string[]): boolean {
  if (allowed.length === 0) return false;
  // Protocol-relative resolves against the viewer's https origin.
  const absolute = url.startsWith("//") ? `https:${url}` : url;
  const lower = resolvedForMatch(absolute).toLowerCase();
  return allowed.some((entry) => {
    const source = entry.toLowerCase();
    if (source.endsWith("/")) return lower.startsWith(source);
    return lower === source || lower.startsWith(`${source}/`) || lower.startsWith(`${source}?`);
  });
}
