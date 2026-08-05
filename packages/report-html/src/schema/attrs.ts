import type { Attrs, DOMOutputSpec, MarkSpec, NodeSpec, TagParseRule } from "prosemirror-model";

/**
 * SECURITY (PR #151 review, Fix 2 — CSS exfiltration): any retained `style`
 * attribute value passes straight through `toDOM` into a real DOM attribute
 * on the trusted app.<domain> origin (ADR-0062 §9). `url(...)` /
 * `image-set(...)` (both fetch a resource — an attacker-controlled URL there
 * leaks e.g. viewport size, referrer, or timing to a third party the moment
 * the doc renders) and `expression(...)` (legacy IE script execution) are
 * stripped by dropping the *whole declaration* they appear in, not just the
 * function call (dropping only the call would leave a dangling/broken
 * declaration). `@import` is stripped the same way since it can load an
 * entire attacker stylesheet. Sibling declarations in the same value (e.g.
 * `color:var(--now)` next to a stripped `background:url(...)`) survive
 * untouched — this is what keeps the round-trip fidelity suite green.
 */
const DANGEROUS_STYLE_FN_RE = /url\s*\(|image-set\s*\(|expression\s*\(/i;
const IMPORT_STATEMENT_RE = /@import[^;]*;?/gi;

export function sanitizeStyle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const withoutImports = raw.replace(IMPORT_STATEMENT_RE, "");
  const declarations = withoutImports
    .split(";")
    .map((d) => d.trim())
    .filter((d) => d.length > 0 && !DANGEROUS_STYLE_FN_RE.test(d));
  return declarations.length > 0 ? declarations.join("; ") : null;
}

/**
 * SECURITY (PR #151 review, Fix 1 — javascript: href): a `javascript:` (or
 * `vbscript:`, or `data:text/html`) URL retained on a `<a href>` is a live
 * XSS primitive the moment a user clicks the rendered link on the trusted
 * app.<domain> origin — ProseMirror only escapes text content, not retained
 * attribute values. Control characters are stripped before matching the
 * scheme prefix since browsers ignore them there too (a classic filter
 * bypass is embedding a tab/newline inside the word, e.g. `jav\tascript:`).
 */
const DANGEROUS_URL_SCHEME_RE = /^(javascript|vbscript):/i;
const DANGEROUS_DATA_HTML_RE = /^data:\s*text\/html/i;

export function isDangerousUrl(value: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — stripping control chars that browsers also ignore when parsing a URL scheme, to close the classic embedded-control-char filter bypass.
  const normalized = value.replace(/[\x00-\x20\x7f]/g, "");
  return DANGEROUS_URL_SCHEME_RE.test(normalized) || DANGEROUS_DATA_HTML_RE.test(normalized);
}

/**
 * Wraps a mark spec whose parsed attrs include `href` (only `link`, here) so
 * a dangerous URL scheme (see `isDangerousUrl`) causes the parse rule to
 * reject the match (`getAttrs` returning `false`) rather than retain it —
 * the `<a>` tag is dropped and its text content survives unmarked, same as
 * any other tag the schema doesn't recognize.
 *
 * SECURITY (PR #156 review, Fix 1): that `getAttrs` check only guards the
 * HTML→doc direction (`parseDOM`). `diffRendered`/`diffDocs` build docs via
 * `Node.fromJSON` from a client-supplied `_source.json` sidecar, which never
 * calls `getAttrs` — a JSON payload can set a link mark's `href` straight to
 * `javascript:alert(1)` and it would otherwise reach `toDOM` untouched. So
 * `toDOM` is wrapped too: it neutralizes (drops) a dangerous `href` rather
 * than trusting whatever's in `attrs`, the same "re-check at output time"
 * treatment `sanitizeStyle` gets everywhere it's retained.
 */
export function withSafeHref<T extends MarkSpec>(spec: T): T {
  const originalToDOM = spec.toDOM as ((n: never) => DOMOutputSpec) | undefined;
  return {
    ...spec,
    parseDOM: ((spec.parseDOM as TagParseRule[] | undefined) ?? []).map((rule) => ({
      ...rule,
      getAttrs: (dom: HTMLElement): Attrs | false => {
        const base = rule.getAttrs ? rule.getAttrs(dom) : (rule.attrs ?? {});
        if (base === false) return false;
        const href = (base as Record<string, unknown> | null)?.href;
        if (typeof href === "string" && isDangerousUrl(href)) return false;
        return (base ?? {}) as Attrs;
      },
    })),
    toDOM: originalToDOM
      ? (markOrNode: never) => neutralizeDangerousHref(originalToDOM(markOrNode))
      : spec.toDOM,
  } as T;
}

/**
 * Drop a `href` attribute from a `[tag, attrs?, ...children]` DOMOutputSpec
 * when it's a dangerous URL scheme (see `isDangerousUrl`) — the toDOM-time
 * half of `withSafeHref`'s belt-and-braces, for docs built via `Node.fromJSON`
 * rather than parsed from HTML.
 */
function neutralizeDangerousHref(spec: DOMOutputSpec): DOMOutputSpec {
  if (!Array.isArray(spec)) return spec;
  const [tag, ...rest] = spec as unknown[];
  const hasAttrsObj =
    rest.length > 0 && typeof rest[0] === "object" && rest[0] !== null && !Array.isArray(rest[0]);
  if (!hasAttrsObj) return spec;
  const attrs = { ...(rest[0] as Record<string, unknown>) };
  if (typeof attrs.href === "string" && isDangerousUrl(attrs.href)) {
    delete attrs.href;
  }
  return [tag, attrs, ...rest.slice(1)] as unknown as DOMOutputSpec;
}

/**
 * Generic attr-retention rule (ADR-0062 §3): any class/attribute not claimed
 * by a named node/mark is preserved verbatim rather than dropped. This
 * helper wraps an existing node/mark spec (one that already has a `toDOM`
 * producing `[tag, attrs?, ...children]`) so parsing also captures `class`
 * and `style`, and `toDOM` re-emits them unchanged. `style` is sanitized on
 * the way in (see `sanitizeStyle`) — the load-bearing fix for Fix 2, since
 * this is the retention path most bespoke chip/card colors go through.
 *
 * Only usable for `tag`-selector parse rules (every call site in this
 * package: paragraph/heading/blockquote/code_block/link/em/strong/list
 * nodes) — a `style`-selector rule's `getAttrs` takes a `string`, not an
 * element, so it isn't a fit for this helper.
 *
 * SECURITY (PR #156 review, Fix 1): `sanitizeStyle` above only runs inside
 * `getAttrs`, i.e. on the HTML→doc direction. `diffRendered`/`diffDocs`
 * build docs via `Node.fromJSON` from a client-supplied `_source.json`
 * sidecar, which never calls `getAttrs` — an unsanitized `style` value set
 * directly in the JSON would otherwise reach `toDOM` untouched. `toDOM`
 * re-sanitizes below rather than trusting `attrs.style` — sanitizeStyle is
 * idempotent, so this is a no-op for the normal parsed-from-HTML case.
 */
export function withClassStyle<T extends NodeSpec | MarkSpec>(spec: T): T {
  const originalToDOM = spec.toDOM as ((n: never) => DOMOutputSpec) | undefined;
  if (!originalToDOM) return spec;
  return {
    ...spec,
    attrs: { ...(spec.attrs ?? {}), class: { default: null }, style: { default: null } },
    parseDOM: ((spec.parseDOM as TagParseRule[] | undefined) ?? []).map((rule) => ({
      ...rule,
      getAttrs: (dom: HTMLElement): Attrs | false => {
        const base = rule.getAttrs ? rule.getAttrs(dom) : (rule.attrs ?? null);
        if (base === false) return false;
        return {
          ...(base || {}),
          class: dom.getAttribute ? dom.getAttribute("class") : null,
          style: sanitizeStyle(dom.getAttribute ? dom.getAttribute("style") : null),
        };
      },
    })),
    toDOM: (nodeOrMark: never) =>
      mergeAttrsIntoOutputSpec(originalToDOM(nodeOrMark), {
        // biome-ignore lint/suspicious/noExplicitAny: nodeOrMark.attrs is typed `any` upstream.
        class: (nodeOrMark as any).attrs.class,
        // biome-ignore lint/suspicious/noExplicitAny: nodeOrMark.attrs is typed `any` upstream.
        style: sanitizeStyle((nodeOrMark as any).attrs.style),
      }),
  } as T;
}

/**
 * Retain the `id` attribute on a NODE spec (ADR-0062 Amendment 3). This is
 * the anchor half of "links behave like links": before this, `id` survived
 * only on `<section>` (`report-blocks.ts`), so `<h2 id="summary">` became a
 * bare `<h2>` after one edit-save and every `#summary` TOC entry became a
 * dead anchor — squarely the regression ADR-0062's own decision driver
 * forbids ("any class or attribute silently dropped by the editor is a
 * product regression").
 *
 * NODE-ONLY, never a mark. Marks split and merge by attribute EQUALITY, so
 * an `id` carried on a mark would be copied onto every run the mark is split
 * into — one `id` silently becoming N duplicate ids across N fragmented
 * `<a>` elements. A node has exactly one DOM element, which is the only
 * shape an `id` is meaningful on.
 *
 * `validate: "string|null"` is load-bearing, not decoration: `Node.fromJSON`
 * — how `diffRendered`/`diffDocs` build docs from the CLIENT-SUPPLIED
 * `_source.json` sidecar — bypasses `getAttrs` entirely (the PR #156
 * lesson), so a sidecar could otherwise set `id` to an object/array and hand
 * it straight to `toDOM`. The validator rejects the doc outright; `toDOM`'s
 * merge additionally only ever emits STRING values, so both ends are closed.
 *
 * ORDERING (silent-failure trap): this wrapper must be applied LAST, on top
 * of every other wrapper. `withParagraphVariant.toDOM` (paragraph.ts) rebuilds
 * its output spec from scratch rather than delegating to the spec it wraps —
 * anything applied UNDER it is erased without a word. Applying `withId` as
 * the outermost sweep (schema.ts) is what keeps `<p id class style>` whole.
 */
export function withId<T extends NodeSpec>(spec: T): T {
  const originalToDOM = spec.toDOM as ((n: never) => DOMOutputSpec) | undefined;
  if (!originalToDOM) return spec;
  return {
    ...spec,
    attrs: { ...(spec.attrs ?? {}), id: { default: null, validate: "string|null" } },
    parseDOM: ((spec.parseDOM as TagParseRule[] | undefined) ?? []).map((rule) => ({
      ...rule,
      getAttrs: (dom: HTMLElement): Attrs | false => {
        const base = rule.getAttrs ? rule.getAttrs(dom) : (rule.attrs ?? null);
        if (base === false) return false;
        return {
          ...(base || {}),
          id: dom.getAttribute ? dom.getAttribute("id") : null,
        };
      },
    })),
    toDOM: (node: never) =>
      mergeAttrsIntoOutputSpec(originalToDOM(node), {
        id: (node as unknown as { attrs: { readonly id?: unknown } }).attrs.id,
      }),
  } as T;
}

/**
 * Merge extra attributes into a `DOMOutputSpec`, whichever of its forms the
 * wrapped `toDOM` produced.
 *
 * SILENT-FAILURE TRAP (ADR-0062 Amendment 3): this used to `return spec`
 * unchanged for any NON-ARRAY spec — which is exactly the form `secNode`
 * (`sec.ts`) returns, `{dom, contentDOM}`, because a declarative array spec
 * cannot express "static prefix content, then a content hole". Every attr
 * merged onto `<h2 class="sec">` was therefore eaten without an error, and a
 * wrapper built on this helper would have shipped green while doing nothing
 * for that node. The non-array forms now set the attributes straight onto
 * the element the spec is built around.
 *
 * Only STRING values are ever written: a non-string that reached here from a
 * `Node.fromJSON`-built doc would otherwise be stringified into a real DOM
 * attribute.
 */
export function mergeAttrsIntoOutputSpec(
  spec: DOMOutputSpec,
  extra: Record<string, unknown>,
): DOMOutputSpec {
  if (!Array.isArray(spec)) {
    const element = outputSpecElement(spec);
    if (element) {
      for (const [k, v] of Object.entries(extra)) {
        if (typeof v === "string" && v !== "") element.setAttribute(k, v);
      }
    }
    return spec;
  }
  const [tag, ...rest] = spec as unknown[];
  const hasAttrsObj =
    rest.length > 0 && typeof rest[0] === "object" && rest[0] !== null && !Array.isArray(rest[0]);
  const attrs: Record<string, unknown> = hasAttrsObj
    ? { ...(rest[0] as Record<string, unknown>) }
    : {};
  const children = hasAttrsObj ? rest.slice(1) : rest;
  for (const [k, v] of Object.entries(extra)) {
    if (typeof v === "string" && v !== "") attrs[k] = v;
  }
  return [tag, attrs, ...children] as unknown as DOMOutputSpec;
}

/** The element a non-array `DOMOutputSpec` is built around: the `dom` of a
 *  `{dom, contentDOM}` pair, or a bare DOM node handed back directly. `null`
 *  for anything without a `setAttribute` (e.g. a plain string spec). */
function outputSpecElement(
  spec: DOMOutputSpec,
): { setAttribute(name: string, value: string): void } | null {
  if (!spec || typeof spec !== "object") return null;
  const candidate = (spec as { readonly dom?: unknown }).dom ?? spec;
  return typeof (candidate as { setAttribute?: unknown })?.setAttribute === "function"
    ? (candidate as { setAttribute(name: string, value: string): void })
    : null;
}
