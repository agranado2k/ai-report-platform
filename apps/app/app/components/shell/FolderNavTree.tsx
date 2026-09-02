import { Link } from "@remix-run/react";
import { ChevronRightIcon, cx, FolderIcon } from "arp-ui";
import { buildFolderTree, type NavFolder } from "./shell-nav";

// The sidebar's lightweight folder NAVIGATION tree (#333): name + hierarchy +
// link, nothing mutating (management lives on the dashboard body — /grill-me
// 2026-09-02). Expand/collapse is the native <details> element — zero JS, CSP-
// safe, and it server-renders open so the tree is visible without hydration.
// No counts here: the per-folder count is a documented N+1 and ships later as
// a grouped query (#343); this component accepts none.
function FolderRow({
  node,
  selectedId,
  depth,
}: {
  node: ReturnType<typeof buildFolderTree>[number];
  selectedId: string | null;
  depth: number;
}) {
  const selected = node.id === selectedId;
  // Indent by depth via inline padding-left (CSP-safe: a style attribute, not
  // an inline <script>; the app CSP allows inline style). Static classes can't
  // express arbitrary depth without a ladder, and the tree nests to 8.
  const pad = { paddingLeft: `${0.5 + depth * 0.75}rem` };
  const link = (
    <Link
      to={`/?folder=${node.id}`}
      title={node.name}
      aria-current={selected ? "page" : undefined}
      className={cx(
        "flex min-w-0 flex-1 items-center gap-1.5 rounded-control py-1 pr-2 text-sm no-underline transition-colors",
        selected ? "bg-brand-soft font-medium text-brand-hover" : "text-fg hover:bg-hover",
      )}
      style={node.children.length === 0 ? pad : undefined}
    >
      <FolderIcon className="size-4 shrink-0" />
      <span className="truncate">{node.name}</span>
    </Link>
  );
  if (node.children.length === 0) return link;
  return (
    <details open className="group/folder">
      <summary
        className="flex list-none items-center gap-0.5 [&::-webkit-details-marker]:hidden"
        style={pad}
      >
        <ChevronRightIcon className="size-3.5 shrink-0 text-placeholder transition-transform group-open/folder:rotate-90" />
        {link}
      </summary>
      <div>
        {node.children.map((child) => (
          <FolderRow key={child.id} node={child} selectedId={selectedId} depth={depth + 1} />
        ))}
      </div>
    </details>
  );
}

export function FolderNavTree({
  folders,
  selectedId,
}: {
  folders: readonly NavFolder[];
  selectedId: string | null;
}) {
  const tree = buildFolderTree(folders);
  if (tree.length === 0) {
    return <p className="px-2 py-1 text-xs text-placeholder">No folders yet</p>;
  }
  return (
    <div className="grid gap-px">
      {tree.map((node) => (
        <FolderRow key={node.id} node={node} selectedId={selectedId} depth={0} />
      ))}
    </div>
  );
}
