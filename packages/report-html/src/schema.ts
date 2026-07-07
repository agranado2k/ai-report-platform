import { Schema } from "prosemirror-model";
import { schema as basicSchema } from "prosemirror-schema-basic";
import { withClassStyle } from "./schema/attrs.js";
import { chipMark } from "./schema/chip.js";
import { htmlBlockNode } from "./schema/generic-block.js";
import { htmlInlineMark, kbdMark, pillMark } from "./schema/marks.js";
import { withParagraphVariant } from "./schema/paragraph.js";
import { secNode } from "./schema/sec.js";

let nodes = basicSchema.spec.nodes;
nodes = nodes.addToEnd("htmlBlock", htmlBlockNode);
nodes = nodes.addToEnd("sec", secNode);
// Retain class/style on every schema-basic node so bespoke classes on
// otherwise-standard elements (e.g. `<h3 class="sub">`) degrade to
// "preserved but uninterpreted" instead of being stripped.
for (const name of ["paragraph", "heading", "blockquote", "code_block"]) {
  const spec = nodes.get(name);
  if (spec) nodes = nodes.update(name, withClassStyle(spec));
}
// `.desc`/`.lede`/`.sub` are recognized paragraph roles (ADR-0062 §3),
// layered on top of the generic class retention above.
nodes = nodes.update("paragraph", withParagraphVariant(nodes.get("paragraph")!));

let marks = basicSchema.spec.marks;
for (const name of ["link", "em", "strong"]) {
  const spec = marks.get(name);
  if (spec) marks = marks.update(name, withClassStyle(spec));
}
marks = marks
  .addToEnd("chip", chipMark)
  .addToEnd("pill", pillMark)
  .addToEnd("kbd", kbdMark)
  .addToEnd("htmlInline", htmlInlineMark);

/**
 * The "Report HTML" schema (ADR-0062 §3) — the ProseMirror document schema
 * for the editable body of a Centaur report. Built up on top of
 * `prosemirror-schema-basic`, extended with the bespoke report vocabulary
 * (chip/pill/kbd marks, generic attr-retention block/inline catch-alls, and
 * — added incrementally below — the structural report nodes).
 */
export const reportSchema = new Schema({ nodes, marks });
