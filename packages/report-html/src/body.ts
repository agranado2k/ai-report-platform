import { JSDOM } from "jsdom";
import { DOMParser as PMDOMParser, DOMSerializer, Node as PMNode } from "prosemirror-model";
import { reportSchema } from "./schema.js";

/**
 * A ProseMirror document, serialized to its plain-JSON representation
 * (`Node#toJSON()` / `Node.fromJSON()`). Structurally a `{ type, content?,
 * attrs?, marks?, text? }` tree; kept as `Record<string, unknown>` rather
 * than a hand-rolled recursive type so it stays exactly what
 * prosemirror-model's own (de)serializers produce and accept.
 */
export type PMDocJson = Record<string, unknown>;

// A single detached jsdom document, reused across calls. jsdom (not the
// vitest/browser DOM) so this package is framework-free and works headlessly
// in Node for both tests and any future server-side use; the app's own
// editor UI will run the same schema against the real browser DOM.
const jsdomWindow = new JSDOM("").window;
const jsdomDocument = jsdomWindow.document;

/**
 * Parse a report body HTML string (the editable-body half of the
 * shell/body split, ADR-0062 §2) into a ProseMirror doc, using the
 * `reportSchema`. Returns the doc's JSON representation — the lossless
 * sidecar shape persisted at `_source.json` (ADR-0062 §4).
 */
export function parseBody(bodyHtml: string): PMDocJson {
  const container = jsdomDocument.createElement("div");
  container.innerHTML = bodyHtml;
  const doc = PMDOMParser.fromSchema(reportSchema).parse(container);
  return doc.toJSON() as PMDocJson;
}

/**
 * Serialize a ProseMirror doc (as JSON) back to a report body HTML string.
 */
export function serializeBody(doc: PMDocJson): string {
  const node = PMNode.fromJSON(reportSchema, doc);
  const serializer = DOMSerializer.fromSchema(reportSchema);
  const fragment = serializer.serializeFragment(node.content, { document: jsdomDocument });
  const container = jsdomDocument.createElement("div");
  container.appendChild(fragment);
  return container.innerHTML;
}
