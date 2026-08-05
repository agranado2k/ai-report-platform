/**
 * Duplicate-`id` dedupe (ADR-0062 Amendment 3). Now that `withId` retains
 * `id` on every node (attrs.ts), the document model can hold the same id
 * twice — and an HTML document with duplicate ids has UNDEFINED anchor
 * behavior (browsers resolve `#x` to whichever element they find first,
 * which is not a contract worth relying on).
 *
 * Three ways it happens, none of them exotic:
 * - an editor user copies a block and pastes it (ProseMirror copies attrs
 *   verbatim — that is the whole point of attr retention);
 * - `splitBlock` (Enter mid-paragraph) copies the node's attrs onto BOTH
 *   halves, so one `<p id="x">` silently becomes two;
 * - a hostile `_source.json` sidecar simply states the same id N times.
 *
 * FIRST WINS: the earliest element in document order keeps the id, later
 * duplicates lose it. That keeps an existing `#summary` anchor pointing at
 * the section it always pointed at — a last-wins rule would make pasting a
 * copy of a section silently redirect every inbound anchor to the copy.
 *
 * SERIALIZE-TIME, not a doc-mutating plugin: the editor's live document may
 * legitimately hold a transient duplicate mid-edit (the instant after a
 * paste, before the user renames anything), and silently rewriting the
 * user's document under them is worse than emitting clean HTML at the one
 * boundary where it matters. Called from `serializeBody` (body.ts) and
 * `diffRendered` (diff.ts) — every path that turns a doc into HTML.
 */
export function dedupeElementIds(container: {
  querySelectorAll(selectors: string): Iterable<Element> | ArrayLike<Element>;
}): void {
  const seen = new Set<string>();
  for (const element of Array.from(container.querySelectorAll("[id]"))) {
    const id = element.getAttribute("id");
    // An empty `id=""` is never a valid anchor target — drop it rather than
    // let it occupy the `seen` set as a legitimate value.
    if (!id) {
      element.removeAttribute("id");
      continue;
    }
    if (seen.has(id)) element.removeAttribute("id");
    else seen.add(id);
  }
}
