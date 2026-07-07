import { Schema } from "prosemirror-model";
import { schema as basicSchema } from "prosemirror-schema-basic";
import { addListNodes } from "prosemirror-schema-list";
import { withClassStyle } from "./schema/attrs.js";
import { chipMark } from "./schema/chip.js";
import { htmlBlockNode } from "./schema/generic-block.js";
import { htmlInlineMark, kbdMark, pillMark } from "./schema/marks.js";
import { withParagraphVariant } from "./schema/paragraph.js";
import {
  cardNode,
  checklistItemNode,
  checklistNode,
  gridNode,
  sectionNode,
} from "./schema/report-blocks.js";
import { secNode } from "./schema/sec.js";
import {
  tableBodyNode,
  tableCellNode,
  tableHeadNode,
  tableHeaderNode,
  tableNode,
  tableRowNode,
  tablewrapNode,
} from "./schema/table.js";

let nodes = addListNodes(basicSchema.spec.nodes, "paragraph block*", "block");
nodes = nodes.addToEnd("htmlBlock", htmlBlockNode);
nodes = nodes
  .addToEnd("section", sectionNode)
  .addToEnd("sec", secNode)
  .addToEnd("card", cardNode)
  .addToEnd("checklist", checklistNode)
  .addToEnd("checklist_item", checklistItemNode)
  .addToEnd("grid", gridNode)
  .addToEnd("tablewrap", tablewrapNode)
  .addToEnd("table", tableNode)
  .addToEnd("table_head", tableHeadNode)
  .addToEnd("table_body", tableBodyNode)
  .addToEnd("table_row", tableRowNode)
  .addToEnd("table_header", tableHeaderNode)
  .addToEnd("table_cell", tableCellNode);
// Retain class/style on every schema-basic node so bespoke classes on
// otherwise-standard elements (e.g. `<h3 class="sub">`) degrade to
// "preserved but uninterpreted" instead of being stripped.
for (const name of [
  "paragraph",
  "heading",
  "blockquote",
  "code_block",
  "bullet_list",
  "ordered_list",
  "list_item",
]) {
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
