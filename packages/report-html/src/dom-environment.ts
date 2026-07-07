import { JSDOM } from "jsdom";

let cachedJsdomDocument: Document | undefined;

/**
 * The `Document` used to build DOM output. Prefers a real global `document`
 * (so `reportSchema` keeps working if reused directly against a real
 * browser DOM later) and falls back to a lazily created, cached jsdom
 * `Document` for Node (server/test) usage.
 *
 * A single shared instance matters here, not just for perf: any `toDOM`
 * that needs to build DOM nodes manually (rather than via the declarative
 * array `DOMOutputSpec` form — see `sec.ts`) must use the *same* document as
 * the rest of the serialization tree, or appending its output into that
 * tree fails cross-document.
 */
export function getDomEnvironmentDocument(): Document {
  if (typeof document !== "undefined") return document;
  if (!cachedJsdomDocument) {
    cachedJsdomDocument = new JSDOM("").window.document as unknown as Document;
  }
  return cachedJsdomDocument;
}
