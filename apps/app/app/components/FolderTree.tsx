import { Form, Link } from "@remix-run/react";
// TYPE-ONLY import of `arp-domain`: `verbatimModuleSyntax` is on, so this emits
// NOTHING at runtime — the barrel (and its `node:crypto`) never reaches the
// client bundle. Hand-copying the union here was how the wire type and the
// domain enum were free to drift.
import type { FolderVisibility } from "arp-domain";
import { type BadgeTone, Button, cx, FolderIcon, Input } from "arp-ui";
import { FolderShareMenu, type FolderShareRow, FolderVisibilityBadge } from "./FolderShareMenu";

/**
 * Client-safe folder shape for the sidebar tree (no org id / timestamps).
 *
 * Everything past `name` is ADR-0076 sharing state, and every field of it is
 * DERIVED IN THE LOADER (apps/app/app/server/folder-sharing.server.ts): the
 * dashboard components must not import `arp-domain`, whose barrel drags
 * `node:crypto` into the client bundle. So the server sends conclusions, not
 * inputs — no ownerId, no predicate, no re-derivation here.
 */
export interface FolderNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  /** Who can see it (ADR-0076) — drives the toggle's direction and label. */
  readonly visibility: FolderVisibility;
  /** Org / Shared with N / Private / Limited, already resolved server-side —
   *  including the unknown-roster case (`Limited`), which never renders as a
   *  positive privacy claim. `title` carries the full sentence, because the
   *  label has to fit a 14rem sidebar. */
  readonly badge: {
    readonly label: string;
    readonly tone: BadgeTone;
    readonly title: string;
  };
  /** The Root (parentId null): the domain refuses ANY visibility call on it,
   *  so the tree renders no sharing affordance for it at all. */
  readonly isRoot: boolean;
  /** Would `loadManagedFolder` + the `acl:write` gate let this viewer manage it? */
  readonly manageable: boolean;
  /** Why not, when it wouldn't. */
  readonly blockedReason: string | null;
  /** THE warning shown before the first action — adoption of this folder,
   *  adoption of the legacy folders inside it, and mass exposure in the org
   *  direction, in one amber note. Null when there is nothing to warn about. */
  readonly shareWarning: string | null;
  /** The cascade checkbox's direction-aware, counted label. Null means render
   *  no checkbox: nothing inside, or too much inside to change at once. */
  readonly cascadeLabel: string | null;
  /** The share roster — only loaded for the folder in `?manage=<id>`; `null`
   *  everywhere else (an unknown roster is never rendered as an empty one). */
  readonly shares: readonly FolderShareRow[] | null;
  /** The roster was REQUESTED for this folder and the load FAILED. Distinct
   *  from `shares === null` (never asked for): an error must not render as
   *  "not shared with anyone". */
  readonly sharesUnavailable: boolean;
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
 * Every non-Root row carries its visibility badge and a `<details>` sharing
 * kebab (the same idiom the report rows use). The selected non-Root folder
 * additionally reveals the inline rename + delete forms. */
export function FolderTree({
  node,
  childrenOf,
  selectedId,
  depth,
  manageHref,
  inertShareNotice,
  rosterUnavailableNotice,
  openMenuId,
}: {
  node: FolderNode;
  childrenOf: (parentId: string | null) => FolderNode[];
  selectedId: string | null;
  depth: number;
  /** Builds the `?manage=<id>` link that makes the loader fetch a roster. */
  manageHref: (folderId: string) => string;
  inertShareNotice: string;
  rosterUnavailableNotice: string;
  /** The folder whose kebab should render already open — the one being
   *  managed, or the one the last action reported on. */
  openMenuId: string | null;
}) {
  const selected = node.id === selectedId;
  const pad = indentClass(depth);
  return (
    <div>
      <div
        className={cx(
          "flex items-center gap-1 rounded-control pr-1 transition-colors",
          pad,
          selected ? "bg-brand/10" : "hover:bg-surface-raised",
        )}
      >
        <Link
          to={`/?folder=${node.id}`}
          // The name is CLIPPED, not wrapped: this column is 14rem wide minus
          // the badge and the kebab, so real folder names render as
          // "Architectu…". The title is the only way to read the rest without
          // opening the folder — there was no `title` and no `aria-label` on
          // this link at all (2026-08-03 dogfood, I-1).
          title={node.name}
          className={cx(
            "min-w-0 flex-1 rounded-control py-1 text-sm no-underline transition-colors",
            selected ? "font-semibold text-brand" : "text-fg hover:text-brand",
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <FolderIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{node.name}</span>
          </span>
        </Link>
        {node.isRoot ? null : (
          <>
            <FolderVisibilityBadge node={node} />
            <FolderShareMenu
              node={node}
              manageHref={manageHref(node.id)}
              inertShareNotice={inertShareNotice}
              rosterUnavailableNotice={rosterUnavailableNotice}
              open={openMenuId === node.id}
            />
          </>
        )}
      </div>
      {selected && !node.isRoot ? (
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
          manageHref={manageHref}
          inertShareNotice={inertShareNotice}
          rosterUnavailableNotice={rosterUnavailableNotice}
          openMenuId={openMenuId}
        />
      ))}
    </div>
  );
}
