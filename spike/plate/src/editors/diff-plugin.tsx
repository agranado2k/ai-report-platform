import * as React from "react";
import { createTSlatePlugin } from "platejs";
import { SlateLeaf } from "platejs/static";

/**
 * Test D — `@platejs/diff` ships `computeDiff(doc0, doc1, options)` as a pure
 * function: it returns a Slate value where changed text runs carry
 * `diff: true` + `diffOperation: { type: 'insert' | 'delete' | 'update' }`.
 * That's ALL it does — there's no shipped decoration component, live-editor
 * plugin wiring, or CSS. Turning that into visible insert/delete markup is
 * entirely on the consumer. This plugin is that missing piece: a leaf mark
 * plugin (mirrors how BaseBoldPlugin -> <strong> works) that renders
 * <ins>/<del>/<mark> depending on `diffOperation.type`.
 */
function DiffLeaf(props: any) {
  const { leaf, children } = props;
  const op = leaf.diffOperation?.type;
  const Tag = op === "insert" ? "ins" : op === "delete" ? "del" : "mark";
  const className = `diff-${op ?? "update"}`;

  return (
    <SlateLeaf {...props} as={Tag} className={className}>
      {children}
    </SlateLeaf>
  );
}

export const DiffPlugin = createTSlatePlugin({
  key: "diff",
  node: { isLeaf: true },
  render: { node: DiffLeaf },
});
