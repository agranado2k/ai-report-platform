import { Schema } from "prosemirror-model";
import { reportSchema } from "./schema.js";

/** Class the dashboard styles (Forge & Ember tokens, ADR-0058) for an inserted run. */
export const DIFF_INS_CLASS = "rd-diff-ins";
/** Class the dashboard styles for a deleted run (rendered as a widget annotation — see diff.ts). */
export const DIFF_DEL_CLASS = "rd-diff-del";

/**
 * A superset of `reportSchema` adding two transient inline marks used only
 * when rendering a visual diff (ADR-0065 §3): `diffIns`/`diffDel`. These are
 * never part of the persisted `_source.json` sidecar or the `reportSchema`
 * contract itself — a doc carrying them only ever exists in memory, for the
 * span of one `diffRendered()` call, which re-parses the plain (mark-free)
 * doc JSON into this schema before decorating it.
 */
const diffMarks = reportSchema.spec.marks
  .addToEnd("diffIns", {
    parseDOM: [],
    toDOM: () => ["span", { class: DIFF_INS_CLASS }, 0],
  })
  .addToEnd("diffDel", {
    parseDOM: [],
    toDOM: () => ["span", { class: DIFF_DEL_CLASS }, 0],
  });

export const diffSchema = new Schema({ nodes: reportSchema.spec.nodes, marks: diffMarks });
