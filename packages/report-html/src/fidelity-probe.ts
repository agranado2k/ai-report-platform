/**
 * Would the editor KEEP these bytes? (ADR-0090)
 *
 * `probeEditability` (ADR-0080) answers whether the editor can OPEN a
 * document. This answers the orthogonal question it leaves open: having
 * opened it, would the editor still have it? The `Report HTML schema` is a
 * constrained document vocabulary, not an HTML superset — it drops
 * `<script>`, flattens `<svg>` to text, and keeps only the retained attribute
 * set — so `editable` is not the reassurance it reads as. A slide deck with
 * inline JavaScript and inline SVG opens cleanly and would be published
 * without its interactivity on the next save.
 *
 * The two verdicts are orthogonal on purpose: `editable` + `lossy` is the
 * interesting case, and it is unrepresentable if fidelity is squeezed in as a
 * fourth editability value.
 *
 * Like `probeEditability`, this answers by CALLING the editor's own functions
 * — `splitShell`, `parseBody`, `serializeBody` — and comparing, never by
 * re-deriving the schema's drop rules. A hand-written denylist of "risky"
 * tags would agree today and go stale silently the first time the schema
 * changed; this tracks it automatically, which is why PR #368's
 * `<section class>` fix changes verdicts here with no edit to this file.
 *
 * NAMING: the probe lives in `fidelity-probe.ts` rather than `fidelity.ts`
 * because `fidelity.test.ts` is already taken, by ADR-0062's class-retention
 * scoring suite. Same word, different job.
 *
 * COST: a full parse plus a serialise, on top of editability's parse. Callers
 * record the answer (`report_versions.fidelity`) rather than re-asking it.
 */

import { parseBody, serializeBody } from "./body.js";
import { getDomEnvironmentDocument } from "./dom-environment.js";
import { splitShell } from "./shell.js";

/** `lossless` = the round trip loses no content. `lossy` = it drops at least one element or attribute. */
export type Fidelity = "lossless" | "lossy";

/**
 * The verdict, plus what a save would cost. The lost items are element and
 * attribute NAMES, deduplicated and sorted — the shape a confirm dialog can
 * put in a sentence. A raw occurrence list would be unreadable and unstable.
 */
export interface FidelityVerdict {
  readonly fidelity: Fidelity;
  readonly lostElements: readonly string[];
  readonly lostAttributes: readonly string[];
}

/**
 * A canonical tree: lowercased tag name, attributes sorted by name, text
 * collapsed. Comparing THESE rather than HTML strings is what makes the
 * comparison mean loss instead of formatting.
 */
export interface NormalizedNode {
  readonly tag: string;
  readonly attributes: readonly (readonly [string, string])[];
  readonly children: readonly (NormalizedNode | string)[];
}

const LOSSLESS: FidelityVerdict = { fidelity: "lossless", lostElements: [], lostAttributes: [] };

/**
 * Normalise a body HTML string into the canonical tree the comparison runs on.
 *
 * Parsing through the DOM is what neutralises the four differences a round
 * trip is entitled to make, and it neutralises them at the source rather than
 * by pattern-matching the output:
 *
 *   - **attribute order** — attributes become a list sorted by name;
 *   - **entity encoding** — the parser decodes `&amp;` and `&#38;` alike, so
 *     text is compared as characters, not as source;
 *   - **self-closing forms** — `<br/>` and `<br>` parse to the same element;
 *   - **whitespace** — runs collapse to one space, and whitespace-only text
 *     between elements is dropped.
 *
 * Exported because the normaliser is the judgement call in this file: it
 * deserves its own tests, not just the probe's.
 */
export function normalizeBody(bodyHtml: string): NormalizedNode[] {
  const document = getDomEnvironmentDocument();
  const container = document.createElement("div");
  container.innerHTML = bodyHtml;
  return normalizeChildren(container);
}

function normalizeChildren(element: Element): NormalizedNode[] {
  const out: NormalizedNode[] = [];
  for (const child of Array.from(element.children ?? [])) out.push(normalizeElement(child));
  return out;
}

function normalizeElement(element: Element): NormalizedNode {
  const attributes = Array.from(element.attributes ?? [])
    .map((a) => [a.name.toLowerCase(), collapse(a.value)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const children: (NormalizedNode | string)[] = [];
  // Adjacent text nodes are MERGED before collapsing, and that is what
  // neutralises entity encoding. The parser splits text at an entity
  // boundary, so `a &amp; b` arrives as three text nodes ("a", "&", " b")
  // while the literal `a & b` arrives as one — same characters, different
  // segmentation. Comparing the segments would call an encoding difference a
  // loss, which is exactly the false positive the normaliser exists to remove.
  let pending = "";
  const flush = () => {
    const text = collapse(pending);
    if (text !== "") children.push(text);
    pending = "";
  };
  for (const node of Array.from(element.childNodes ?? [])) {
    // 1 = element, 3 = text. Comments and processing instructions carry no
    // content the editor could lose, so they are not part of the comparison.
    if (node.nodeType === 1) {
      flush();
      children.push(normalizeElement(node as Element));
    } else if (node.nodeType === 3) pending += node.textContent ?? "";
  }
  flush();

  return { tag: String(element.tagName ?? "").toLowerCase(), attributes, children };
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Answer whether the editor would keep `html`, without asking it to.
 *
 * `hasSourceDoc` short-circuits to `lossless` WITHOUT parsing: a version
 * carrying a `_source.json` sidecar (every editor-authored save, ADR-0062 §4)
 * has a body that `serializeBody` produced, so the round trip is the identity
 * by construction. Parsing to rediscover that would be slower and could only
 * manufacture a false negative.
 *
 * Returns `null` for UNKNOWN — bytes with no usable `<body>` boundary, or a
 * body that defeats the parser. There is no round trip to run and therefore no
 * honest verdict: the editor never gets far enough to keep or drop anything.
 * `null` is never a guess and is never read as `lossless`.
 *
 * Total by contract. It catches thrown values of every kind, not just `Error`,
 * because this leg's realistic failure is a `RangeError` out of ProseMirror's
 * recursive descent — and a probe on the upload path must never become a new
 * crash site. An upload is never rejected for being lossy.
 */
export function probeFidelity(html: string, hasSourceDoc = false): FidelityVerdict | null {
  try {
    // The shell must split even with a sidecar, exactly as `probeEditability`
    // requires it: an unclosed `<body>` is un-openable whatever the sidecar
    // says, and there is still no round trip to answer for.
    const { bodyHtml } = splitShell(html);
    if (hasSourceDoc) return LOSSLESS;

    const roundTripped = serializeBody(parseBody(bodyHtml));

    const before = normalizeBody(bodyHtml);
    const after = normalizeBody(roundTripped);

    // The exact path: when the canonical trees match, nothing was lost and
    // nothing needs naming. It is reachable at all only because of the
    // normaliser above.
    if (JSON.stringify(before) === JSON.stringify(after)) return LOSSLESS;

    const lostElements = missing(elementNames(before), elementNames(after));
    const lostAttributes = missing(attributeNames(before), attributeNames(after));

    // A difference that costs no element and no attribute is not loss: the
    // parser legitimately ADDS structure (it wraps loose text in paragraphs),
    // and gaining a wrapper is not the same as losing content.
    if (lostElements.length === 0 && lostAttributes.length === 0) return LOSSLESS;

    return { fidelity: "lossy", lostElements, lostAttributes };
  } catch {
    return null;
  }
}

/**
 * PRESENCE, not occurrence count. A name is lost when the round trip leaves
 * NONE of it behind.
 *
 * The generated-report fixture round-trips 45 `style` attributes in and 41
 * out, because the schema normalises a few away per element. Counting
 * occurrences would therefore mark the entire existing corpus `lossy` and
 * leave the field as uninformative as the byte equality ADR-0090 rejects. The
 * accepted cost is stated in that record: a partial loss of a name that
 * survives elsewhere is deliberately not reported.
 */
function missing(before: Set<string>, after: Set<string>): string[] {
  return [...before].filter((name) => !after.has(name)).sort();
}

function elementNames(nodes: readonly (NormalizedNode | string)[]): Set<string> {
  const out = new Set<string>();
  walk(nodes, (node) => out.add(node.tag));
  return out;
}

function attributeNames(nodes: readonly (NormalizedNode | string)[]): Set<string> {
  const out = new Set<string>();
  walk(nodes, (node) => {
    for (const [name] of node.attributes) out.add(name);
  });
  return out;
}

function walk(
  nodes: readonly (NormalizedNode | string)[],
  visit: (node: NormalizedNode) => void,
): void {
  for (const node of nodes) {
    if (typeof node === "string") continue;
    visit(node);
    walk(node.children, visit);
  }
}
