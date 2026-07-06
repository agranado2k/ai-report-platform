import {
  BaseTablePlugin,
  BaseTableRowPlugin,
  BaseTableCellPlugin,
  BaseTableCellHeaderPlugin,
} from "@platejs/table";

/**
 * FINDING: the base (non-React-kit) `@platejs/table` plugins carry no
 * `render.as` at all — the static/headless renderer falls back to a bare
 * `<div data-slate-type="tr">` etc for every table node. Real `<table>`,
 * `<tr>`, `<td>`, `<th>` tags require *some* explicit render config; the
 * live-editor "kits" (`@platejs/table/react` TableKit) supply React
 * components that do this, but that's a heavier, editing-UI-focused layer
 * (resize handles, selection, toolbar), not something a headless/static
 * consumer would reach for. This is the one-line fix — `.extend({render:{as}})`
 * — used from L1 onward. L0 deliberately does NOT include this, to show
 * what "no customization" actually gets you out of the box.
 */
export function tablePluginsWithSemanticTags() {
  return [
    BaseTablePlugin.extend({ render: { as: "table" } }),
    BaseTableRowPlugin.extend({ render: { as: "tr" } }),
    BaseTableCellPlugin.extend({ render: { as: "td" } }),
    BaseTableCellHeaderPlugin.extend({ render: { as: "th" } }),
  ];
}
