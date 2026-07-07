import { BaseParagraphPlugin } from "platejs";
import {
  BaseBasicBlocksPlugin,
  BaseBasicMarksPlugin,
} from "@platejs/basic-nodes";
import { BaseListPlugin } from "@platejs/list-classic";
import { GenericBlockPlugin, GenericInlinePlugin } from "./generic-plugin";
import { tablePluginsWithSemanticTags } from "./table-plugins";

/**
 * L1 = L0's coverage, but with:
 *  - the table plugins patched to emit semantic <table>/<tr>/<td>/<th>
 *    (see table-plugins.ts — a one-line `render.as` fix, still "config").
 *  - a generic block + generic inline passthrough for any other
 *    unrecognized tag (see generic-plugin.tsx).
 */
export function l1Plugins() {
  return [
    BaseParagraphPlugin,
    BaseBasicBlocksPlugin,
    BaseBasicMarksPlugin,
    BaseListPlugin,
    ...tablePluginsWithSemanticTags(),
    GenericBlockPlugin,
    GenericInlinePlugin,
  ];
}
