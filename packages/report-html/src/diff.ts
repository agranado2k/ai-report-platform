import { ChangeSet, simplifyChanges } from "prosemirror-changeset";
import { DOMSerializer, Node as PMNode } from "prosemirror-model";
import { Transform } from "prosemirror-transform";
import type { PMDocJson } from "./body.js";
import { diffSchema } from "./diff-schema.js";
import { getDomEnvironmentDocument } from "./dom-environment.js";
import { reportSchema } from "./schema.js";

/**
 * One word-level change hunk, in the coordinate spaces of both documents
 * (`A` = old doc, `B` = new doc — prosemirror-changeset's own naming). A
 * hunk with `deletedText === ""` is a pure insertion; one with
 * `insertedText === ""` is a pure deletion; both non-empty is a replacement
 * (e.g. a whole-word swap).
 */
export interface ChangeRange {
  readonly fromA: number;
  readonly toA: number;
  readonly fromB: number;
  readonly toB: number;
  readonly deletedText: string;
  readonly insertedText: string;
}

export interface DocDiff {
  readonly changes: readonly ChangeRange[];
}

/**
 * Diff two ProseMirror doc JSONs by building a single `Transform` that
 * replaces the whole of `oldDoc`'s content with `newDoc`'s, then handing its
 * step maps to `prosemirror-changeset`. The library re-diffs the replaced
 * range internally (it does not need minimal steps — that's the point of
 * using it over a hand-rolled text diff) down to word-level insert/delete
 * spans; `simplifyChanges` then expands raw character-level overlaps to word
 * boundaries so "jumps" -> "leaps" reads as one whole-word swap rather than
 * a "jum"/"lea" stem overlap. Spike-proven mechanism (ADR-0065 §3,
 * `spike/DECISION.md` via PR #144).
 */
function computeChangeSet(oldDoc: PMNode, newDoc: PMNode) {
  const tr = new Transform(oldDoc);
  tr.replace(0, oldDoc.content.size, newDoc.slice(0, newDoc.content.size));
  // tr.doc is structurally identical to newDoc (a full-content replace) —
  // used rather than newDoc itself so the changeset is computed against the
  // exact doc the step maps actually produced.
  const changeSet = ChangeSet.create(oldDoc).addSteps(tr.doc, tr.mapping.maps, null);
  return simplifyChanges(changeSet.changes, tr.doc);
}

/** Diff two report bodies (ADR-0065 §3) — a framework-free, render-ready change model. */
export function diffDocs(oldDocJson: PMDocJson, newDocJson: PMDocJson): DocDiff {
  const oldDoc = PMNode.fromJSON(reportSchema, oldDocJson);
  const newDoc = PMNode.fromJSON(reportSchema, newDocJson);
  const simplified = computeChangeSet(oldDoc, newDoc);

  const changes = simplified.map(
    (c): ChangeRange => ({
      fromA: c.fromA,
      toA: c.toA,
      fromB: c.fromB,
      toB: c.toB,
      deletedText: oldDoc.textBetween(c.fromA, c.toA, " "),
      insertedText: newDoc.textBetween(c.fromB, c.toB, " "),
    }),
  );
  return { changes };
}

/**
 * Render the merged body HTML for two doc versions, with
 * `<span class="rd-diff-ins">` / `<span class="rd-diff-del">` markers (see
 * `diff-schema.ts` — classes, not bare `<ins>`/`<del>`, so the dashboard
 * styles them with Forge & Ember tokens, ADR-0058). Mechanism: apply the
 * change ranges as marks/inserts on a copy of the new doc parsed into
 * `diffSchema` (a superset of `reportSchema` with two transient inline
 * marks), highest position first so earlier positions in the same pass stay
 * valid as later edits shift the document.
 *
 * Deletions have no position in the new document (their `toB === fromB`),
 * so — mirroring the spike's `Decoration.widget` approach — the deleted
 * text is inserted as its own marked run immediately before the
 * corresponding insertion point. Accepted ADR-0065 limitation: a change
 * spanning a paragraph boundary collapses the deleted text into a single
 * run rather than preserving the original paragraph split (not a bug to fix
 * in this epic — see ADR-0065's Consequences).
 */
export function diffRendered(oldDocJson: PMDocJson, newDocJson: PMDocJson): string {
  const oldDoc = PMNode.fromJSON(reportSchema, oldDocJson);
  const newDoc = PMNode.fromJSON(reportSchema, newDocJson);
  const simplified = computeChangeSet(oldDoc, newDoc);

  const decorated = PMNode.fromJSON(diffSchema, newDoc.toJSON());
  const tr = new Transform(decorated);

  const diffIns = diffSchema.marks.diffIns;
  const diffDel = diffSchema.marks.diffDel;
  if (!diffIns || !diffDel) {
    throw new Error("diffRendered: diffSchema is missing the diffIns/diffDel marks");
  }

  const orderedByPositionDescending = [...simplified].sort((a, b) => b.fromB - a.fromB);
  for (const change of orderedByPositionDescending) {
    if (change.toB > change.fromB) {
      tr.addMark(change.fromB, change.toB, diffIns.create());
    }
    if (change.toA > change.fromA) {
      const deletedText = oldDoc.textBetween(change.fromA, change.toA, " ");
      if (deletedText.length > 0) {
        tr.insert(change.fromB, diffSchema.text(deletedText, [diffDel.create()]));
      }
    }
  }

  const document = getDomEnvironmentDocument();
  const serializer = DOMSerializer.fromSchema(diffSchema);
  const fragment = serializer.serializeFragment(tr.doc.content, { document });
  const container = document.createElement("div");
  container.appendChild(fragment);
  return container.innerHTML;
}
