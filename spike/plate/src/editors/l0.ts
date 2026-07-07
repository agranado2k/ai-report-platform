import { BaseParagraphPlugin } from "platejs";
import {
  BaseBasicBlocksPlugin,
  BaseBasicMarksPlugin,
} from "@platejs/basic-nodes";
import { BaseListPlugin } from "@platejs/list-classic";
import {
  BaseTablePlugin,
  BaseTableRowPlugin,
  BaseTableCellPlugin,
  BaseTableCellHeaderPlugin,
} from "@platejs/table";

/**
 * L0 — "default Plate plugins, no customization."
 *
 * This is the plugin set a team would reach for out of the box to cover the
 * HTML surface in a typical rich-text report: paragraphs, headings,
 * blockquote/hr, bold/italic/underline/etc, semantic <ul>/<ol>/<li> lists,
 * and tables. No bespoke elements, no attribute-preservation config.
 */
export function l0Plugins() {
  return [
    BaseParagraphPlugin,
    BaseBasicBlocksPlugin,
    BaseBasicMarksPlugin,
    BaseListPlugin,
    BaseTablePlugin,
    BaseTableRowPlugin,
    BaseTableCellPlugin,
    BaseTableCellHeaderPlugin,
  ];
}
