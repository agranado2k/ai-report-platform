import { Form, Link } from "@remix-run/react";
import { Button, cx, FolderIcon, Input } from "arp-ui";

/** Client-safe folder shape for the sidebar tree (no org id / timestamps). */
export interface FolderNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
}

// Static indent classes per depth (CSP-safe — no inline style). Folders nest at
// most MAX_FOLDER_DEPTH (8); deeper rows clamp to the last step.
const INDENT = [
  "pl-2",
  "pl-6",
  "pl-10",
  "pl-14",
  "pl-[4.5rem]",
  "pl-20",
  "pl-24",
  "pl-28",
  "pl-32",
];
const indentClass = (depth: number) => INDENT[Math.min(depth, INDENT.length - 1)];

/** Recursively render a folder + children as an indented, selectable tree.
 * The selected non-Root folder reveals inline rename + delete forms. */
export function FolderTree({
  node,
  childrenOf,
  selectedId,
  depth,
}: {
  node: FolderNode;
  childrenOf: (parentId: string | null) => FolderNode[];
  selectedId: string | null;
  depth: number;
}) {
  const selected = node.id === selectedId;
  const pad = indentClass(depth);
  return (
    <div>
      <Link
        to={`/?folder=${node.id}`}
        className={cx(
          "block rounded-control py-1 pr-2 text-sm no-underline transition-colors",
          pad,
          selected ? "bg-brand/10 font-semibold text-brand" : "text-fg hover:bg-surface-raised",
        )}
      >
        <span className="inline-flex items-center gap-1.5">
          <FolderIcon className="h-3.5 w-3.5 shrink-0" />
          {node.name}
        </span>
      </Link>
      {selected && node.parentId !== null ? (
        <div className={cx("my-1 flex flex-col gap-1.5", pad)}>
          <Form method="post" className="flex gap-1.5">
            <input type="hidden" name="intent" value="rename-folder" />
            <input type="hidden" name="folderId" value={node.id} />
            <Input
              name="name"
              defaultValue={node.name}
              aria-label={`Rename ${node.name}`}
              size="sm"
              className="w-28 text-xs"
            />
            <Button type="submit" size="sm">
              Rename
            </Button>
          </Form>
          <Form method="post">
            <input type="hidden" name="intent" value="delete-folder" />
            <input type="hidden" name="folderId" value={node.id} />
            <Button type="submit" size="sm" variant="danger">
              Delete (must be empty)
            </Button>
          </Form>
        </div>
      ) : null}
      {childrenOf(node.id).map((child) => (
        <FolderTree
          key={child.id}
          node={child}
          childrenOf={childrenOf}
          selectedId={selectedId}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}
