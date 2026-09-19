/**
 * What the OWNER VIEW's sandboxed frame cannot run — asked at upload time so the
 * author learns it while they still hold the document (ticket #385, PRD #356).
 *
 * The owner view (ADR-0089) frames the byte-for-byte report in a sandbox that
 * withholds `allow-same-origin` — deliberately, because that absence is the
 * containment (ADR-0089 §2, ADR-0091). Inside that opaque origin `localStorage`,
 * `sessionStorage` and `document.cookie` each throw `SecurityError` on access
 * (verified, Chromium 148). A report whose inline bootstrap reads one of them
 * BEFORE first paint dies on the uncaught throw and renders blank. This module
 * finds those reads so `uploadReport` can warn the author (ADR-0092).
 *
 * TWO RULES, the same two `resource-scan.ts` states, for the same reasons.
 *
 * 1. **This is a scan, never a fetch** (ADR-0069): the uploaded document is
 *    untrusted content. The function is synchronous and reads text — it opens no
 *    socket and dereferences nothing.
 * 2. **Advisory only.** Nothing here rejects an upload or changes a status code.
 *    Publishing storage-reading content is legitimate; the report still views at
 *    the canonical `/<slug>`, which is a real top-level origin. The author simply
 *    deserves to know it will blank in the owner view's frame.
 *
 * WHY A REAL PARSER, NOT A TOKEN SEARCH. The remediation this feeds is "wrap the
 * access in try/catch", so a substring match for `localStorage` would keep
 * nagging the author who already did exactly that, and would fire on a read
 * inside a handler that never runs before paint. An AST lets the scan flag only
 * what the failure needs: a read that executes at the top level of the script,
 * unguarded. `acorn` is linear-time, so unlike the CSS `url()` regex path it
 * carries no catastrophic-backtracking risk on a hostile document.
 */

import type { Node } from "acorn";
import { parse } from "acorn";
import { parseHTML } from "linkedom";

/** The three storage APIs that throw in the owner view's opaque-origin frame. */
export type SandboxStorageApi = "localStorage" | "sessionStorage" | "document.cookie";

/** One storage API read at the top level of an inline script. */
export interface SandboxStorageAccess {
  /** Which API is read — the string an author can search their source for. */
  readonly api: SandboxStorageApi;
}

/** `<script type>` values that hold JavaScript the browser executes. Anything
 *  else (`application/json`, `importmap`, a `text/template`) is a data block:
 *  it is not run, so it cannot throw, so it is not analysed. An absent or empty
 *  `type` is a classic script. */
const EXECUTABLE_SCRIPT_TYPES = new Set([
  "",
  "text/javascript",
  "application/javascript",
  "application/x-javascript",
  "text/ecmascript",
  "application/ecmascript",
  "module",
]);

/** The two globals whose bare or `window.`-qualified read throws. */
const STORAGE_GLOBALS: Record<string, SandboxStorageApi> = {
  localStorage: "localStorage",
  sessionStorage: "sessionStorage",
};

/** Objects any `.cookie` hangs off that we treat as `document`. */
const DOCUMENT_HOLDERS = new Set(["window", "globalThis", "self"]);

/**
 * Report every distinct storage API read at the top level of an inline
 * `<script>` in `html`, first-seen order, deduplicated.
 *
 * Total by contract — malformed HTML, or an inline script that does not parse,
 * contributes nothing rather than throwing, because the caller is an upload that
 * must not fail for asking a question.
 */
export function scanSandboxStorageAccess(html: string): readonly SandboxStorageAccess[] {
  let document: Document;
  try {
    document = parseHTML(html).document as unknown as Document;
  } catch {
    return [];
  }

  const found: SandboxStorageApi[] = [];
  const seen = new Set<SandboxStorageApi>();
  const record = (api: SandboxStorageApi): void => {
    if (seen.has(api)) return;
    seen.add(api);
    found.push(api);
  };

  for (const el of document.querySelectorAll("script")) {
    // A src'd script has no inline body to analyse; its host is the resource
    // scan's concern (ADR-0088), not this one.
    if (el.hasAttribute("src")) continue;
    const type = (el.getAttribute("type") ?? "").trim().toLowerCase();
    if (!EXECUTABLE_SCRIPT_TYPES.has(type)) continue;
    const source = el.textContent ?? "";
    if (source.trim() === "") continue;
    scanScript(source, type === "module", record);
  }

  return found.map((api) => ({ api }));
}

/** Parse one inline script and walk its synchronous top-level execution path. */
function scanScript(
  source: string,
  isModule: boolean,
  record: (api: SandboxStorageApi) => void,
): void {
  let program: Node;
  try {
    program = parse(source, {
      ecmaVersion: "latest",
      sourceType: isModule ? "module" : "script",
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      allowHashBang: true,
    });
  } catch {
    // A script nobody can parse names no access anybody can act on.
    return;
  }
  // `inExec` = runs during synchronous top-level evaluation (the Program body,
  // and the bodies of IIFEs invoked from it). `guarded` = inside a `try`, so a
  // throw is already caught — which is the exact shape the warning would ask for.
  walk(program, record, true, false);
}

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

const isFunction = (node: AnyNode): boolean => FUNCTION_TYPES.has(node.type);

/** ESTree nodes carry arbitrary child properties; walk them generically. */
interface AnyNode {
  type: string;
  [key: string]: unknown;
}

const isNode = (value: unknown): value is AnyNode =>
  typeof value === "object" && value !== null && typeof (value as AnyNode).type === "string";

function walk(
  raw: Node | AnyNode,
  record: (api: SandboxStorageApi) => void,
  inExec: boolean,
  guarded: boolean,
): void {
  const node = raw as AnyNode;
  if (inExec && !guarded) detect(node, record);

  switch (node.type) {
    case "TryStatement": {
      // The `try` block is the guarded region; its catch/finally also run under
      // a handler in practice, so treat the whole statement as guarded — a read
      // there is either caught or a fallback the author wrote on purpose.
      for (const child of childNodes(node)) walk(child, record, inExec, true);
      return;
    }
    case "CallExpression":
    case "NewExpression": {
      const callee = node.callee;
      // An IIFE — `(function(){…})()` / `(()=>{…})()` — runs its body NOW, so
      // its body stays on the synchronous exec path (guarded resets: the IIFE
      // opens a fresh scope with no try around it yet).
      if (isNode(callee) && isFunction(callee)) {
        for (const child of childNodes(callee)) walk(child, record, inExec, false);
      } else if (isNode(callee)) {
        walk(callee, record, inExec, guarded);
      }
      // A call's ARGUMENTS are evaluated synchronously at the call site, so a
      // read among them (`foo(localStorage.getItem("x"))`) still counts.
      if (Array.isArray(node.arguments)) {
        for (const arg of node.arguments) if (isNode(arg)) walk(arg, record, inExec, guarded);
      }
      return;
    }
    default: {
      if (isFunction(node)) {
        // A function reached any other way is DEFINED here but called later (a
        // handler, a callback, a stored reference). Its body is deferred — off
        // the synchronous exec path — so a read inside it will not blank paint.
        for (const child of childNodes(node)) walk(child, record, false, false);
        return;
      }
      for (const child of childNodes(node)) walk(child, record, inExec, guarded);
    }
  }
}

/** Every child node of `node`, in no particular order, skipping the `type` tag
 *  and any non-node scalar. */
function* childNodes(node: AnyNode): Generator<AnyNode> {
  for (const [key, value] of Object.entries(node)) {
    if (key === "type") continue;
    if (isNode(value)) yield value;
    else if (Array.isArray(value)) for (const el of value) if (isNode(el)) yield el;
  }
}

/** Fire when `node` IS an access to one of the three throwing APIs. Detection is
 *  per-node with local shape checks — no parent context needed, because each
 *  shape below is unambiguous on its own. */
function detect(node: AnyNode, record: (api: SandboxStorageApi) => void): void {
  if (node.type === "MemberExpression") {
    const api = memberAccess(node);
    if (api) record(api);
    return;
  }
  if (node.type === "Identifier") {
    const api = STORAGE_GLOBALS[node.name as string];
    // A bare `localStorage` / `sessionStorage` reference. `nonReferencePositions`
    // (declaration ids, property keys, member `.property`) are pruned by walking
    // MemberExpression via its own case above and by these globals never being
    // legitimate binding names in generated reports.
    if (api) record(api);
  }
}

/** `document.cookie`, `window.localStorage`, `document["cookie"]`, … — the
 *  member shapes that read a throwing API. Returns the API or `undefined`. */
function memberAccess(node: AnyNode): SandboxStorageApi | undefined {
  const object = node.object;
  const name = memberName(node);
  if (name === undefined || !isNode(object)) return undefined;

  // `document.cookie` (and `window.document.cookie`, `globalThis.document…`).
  if (name === "cookie" && isDocument(object)) return "document.cookie";

  // `window.localStorage` / `globalThis.sessionStorage` — the qualified globals.
  if (
    (name === "localStorage" || name === "sessionStorage") &&
    object.type === "Identifier" &&
    DOCUMENT_HOLDERS.has(object.name as string)
  ) {
    return STORAGE_GLOBALS[name];
  }
  return undefined;
}

/** The property name of a member expression, computed (`x["cookie"]`) or not
 *  (`x.cookie`). `undefined` for a computed access whose key is not a string
 *  literal — which names nothing we can act on. */
function memberName(node: AnyNode): string | undefined {
  const property = node.property;
  if (!isNode(property)) return undefined;
  if (node.computed) {
    return property.type === "Literal" && typeof property.value === "string"
      ? property.value
      : undefined;
  }
  return property.type === "Identifier" ? (property.name as string) : undefined;
}

/** Is `node` the `document` global — bare, or `window.document` / `self.document`? */
function isDocument(node: AnyNode): boolean {
  if (node.type === "Identifier") return node.name === "document";
  if (node.type === "MemberExpression") {
    return (
      memberName(node) === "document" &&
      isNode(node.object) &&
      node.object.type === "Identifier" &&
      DOCUMENT_HOLDERS.has((node.object as AnyNode).name as string)
    );
  }
  return false;
}
