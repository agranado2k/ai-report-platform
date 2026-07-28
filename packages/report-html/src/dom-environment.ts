import { parseHTML } from "linkedom";

let cachedServerDocument: Document | undefined;

/**
 * The `Document` used to build DOM output. Prefers a real global `document`
 * (so `reportSchema` keeps working if reused directly against a real browser
 * DOM), and falls back to a cached server-side document for Node (server/test).
 *
 * The server backend is **linkedom**, not jsdom: jsdom proved un-shippable on
 * Vercel's serverless runtime — first its transitive `css-tree` couldn't trace
 * its `data/patch.json`, then `html-encoding-sniffer@6` `require()`d the
 * ESM-only `@exodus/bytes` (`ERR_REQUIRE_ESM`) — both crashed every route at
 * boot. linkedom is a serverless-native DOM with no native binaries, data
 * files, or ESM-interop landmines, and covers everything report-html needs
 * (`createElement` + `innerHTML` get/set for ProseMirror parse/serialize).
 *
 * A single shared instance matters, not just for perf: any `toDOM` that builds
 * DOM nodes manually (rather than via the declarative array `DOMOutputSpec`
 * form — see `sec.ts`) must use the *same* document as the rest of the
 * serialization tree, or appending its output into that tree fails
 * cross-document.
 */
export function getDomEnvironmentDocument(): Document {
  if (typeof document !== "undefined") return document;
  if (!cachedServerDocument) {
    cachedServerDocument = parseHTML("<!doctype html><html><body></body></html>")
      .document as unknown as Document;
  }
  return cachedServerDocument;
}
