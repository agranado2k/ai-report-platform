import type { Attrs, DOMOutputSpec, MarkSpec, TagParseRule } from "prosemirror-model";
import { mergeAttrsIntoOutputSpec } from "./attrs.js";

/**
 * `target`/`rel` retention on the `link` mark (ADR-0062 Amendment 3) — the
 * "new tab" half of "links behave like links". Before this the mark carried
 * only `href`/`title`, so an author's `target="_blank" rel="noopener
 * noreferrer"` was ERASED on every edit-save: the same link opened in a new
 * tab before the report was ever edited and in the same tab afterwards.
 *
 * NORMALIZED, not preserved verbatim. The platform serves untrusted,
 * third-party HTML (ADR-012/ADR-013), so `target`/`rel` are a security
 * surface, not free-form styling:
 *
 * - **`target`**: only `_blank` is retained. `_top`/`_parent`/a named frame
 *   are FRAME-ESCAPE primitives — inside the viewer's sandboxed top-level
 *   document (`view-headers.ts`) or the editor's sandboxed iframe they are
 *   an author's attempt to steer navigation of a frame they don't own. There
 *   is no legitimate report use for them; `_blank` covers "open a new tab",
 *   which is the entire product requirement.
 * - **`rel`**: an allowlist of the standard link-relation tokens, with
 *   `opener` STRIPPED unconditionally — `rel="opener"` exists precisely to
 *   UNDO the `noopener` tabnabbing mitigation (it restores `window.opener`
 *   on the new tab, letting the opened page rewrite the report's own
 *   location). Unrecognized tokens are dropped rather than passed through:
 *   the generic attr-retention rule (ADR-0062 §3) governs `class`/`style`,
 *   which are inert; `rel` changes browser BEHAVIOR.
 * - **When `target === "_blank"`**, `rel` is emitted as the UNION of the
 *   author's surviving tokens with `noopener noreferrer`, so a new tab can
 *   never reach back into the report's window regardless of what the author
 *   wrote (or omitted).
 *
 * Normalized in BOTH `getAttrs` and `toDOM` for the same reason
 * `sanitizeStyle`/`withSafeHref` are: `Node.fromJSON`, building a doc from
 * the client-supplied `_source.json` sidecar, never calls `getAttrs` (the PR
 * #156 lesson). `toDOM` re-normalizes rather than trusting `mark.attrs`.
 *
 * Union-with-forced-tokens is deliberately IDEMPOTENT (dedupe on the way in,
 * dedupe again on the way out) — the pinned `serialize(parse(serialize(parse
 * (h))))` guard exists because a naive `rel + " noopener noreferrer"` would
 * grow the attribute by two tokens on every single save.
 */
const TARGET_BLANK = "_blank";

/** Forced whenever the link opens a new browsing context. */
const FORCED_BLANK_REL = ["noopener", "noreferrer"] as const;

/**
 * The standard HTML link relations that are meaningful on an `<a>` and inert
 * with respect to navigation control. `opener` is DELIBERATELY absent (see
 * above); so are document-level relations (`stylesheet`, `preload`,
 * `icon`, `manifest`, …) which are resource-loading directives, not link
 * semantics, and have no business on a report's inline anchor.
 */
const REL_ALLOWLIST: ReadonlySet<string> = new Set([
  "alternate",
  "author",
  "bookmark",
  "external",
  "help",
  "license",
  "me",
  "next",
  "nofollow",
  "noopener",
  "noreferrer",
  "prev",
  "search",
  "sponsored",
  "tag",
  "ugc",
]);

/** `_blank` (normalized) or `null`. Anything else — `_top`, `_parent`, a
 *  named frame, a non-string from a hostile sidecar — is dropped. */
export function normalizeLinkTarget(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  return raw.trim().toLowerCase() === TARGET_BLANK ? TARGET_BLANK : null;
}

/** The allowlisted, deduplicated `rel` token list for a link, unioned with
 *  `noopener noreferrer` when it opens a new tab. `null` when nothing
 *  survives (so no empty `rel=""` is emitted). Author order is preserved;
 *  forced tokens are appended only if missing — that is what makes repeated
 *  application a no-op. */
export function normalizeLinkRel(raw: unknown, target: string | null): string | null {
  const tokens: string[] = [];
  if (typeof raw === "string") {
    for (const token of raw.trim().toLowerCase().split(/\s+/)) {
      if (!REL_ALLOWLIST.has(token)) continue;
      if (!tokens.includes(token)) tokens.push(token);
    }
  }
  if (target === TARGET_BLANK) {
    for (const forced of FORCED_BLANK_REL) {
      if (!tokens.includes(forced)) tokens.push(forced);
    }
  }
  return tokens.length > 0 ? tokens.join(" ") : null;
}

/**
 * Wrap the `link` mark spec so `target`/`rel` round-trip under the rules
 * above. Composed as `withClassStyle(withLinkTargetRel(withSafeHref(spec)))`
 * in schema.ts — `withSafeHref` INNERMOST so a `javascript:` href still
 * rejects the whole parse rule (dropping the `<a>` entirely, target and all)
 * before this wrapper ever gets to retain anything from it.
 */
export function withLinkTargetRel<T extends MarkSpec>(spec: T): T {
  const originalToDOM = spec.toDOM as ((m: never) => DOMOutputSpec) | undefined;
  if (!originalToDOM) return spec;
  return {
    ...spec,
    attrs: {
      ...(spec.attrs ?? {}),
      target: { default: null, validate: "string|null" },
      rel: { default: null, validate: "string|null" },
    },
    parseDOM: ((spec.parseDOM as TagParseRule[] | undefined) ?? []).map((rule) => ({
      ...rule,
      getAttrs: (dom: HTMLElement): Attrs | false => {
        const base = rule.getAttrs ? rule.getAttrs(dom) : (rule.attrs ?? null);
        if (base === false) return false;
        const target = normalizeLinkTarget(dom.getAttribute ? dom.getAttribute("target") : null);
        return {
          ...(base || {}),
          target,
          rel: normalizeLinkRel(dom.getAttribute ? dom.getAttribute("rel") : null, target),
        };
      },
    })),
    toDOM: (mark: never) => {
      const attrs = (mark as unknown as { attrs: Record<string, unknown> }).attrs;
      const target = normalizeLinkTarget(attrs.target);
      return mergeAttrsIntoOutputSpec(originalToDOM(mark), {
        target,
        rel: normalizeLinkRel(attrs.rel, target),
      });
    },
  } as T;
}
