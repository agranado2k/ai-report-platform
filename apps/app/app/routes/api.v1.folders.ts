// GET /api/v1/folders — list the acting org's folders (ADR-0036, Reports &
// Folders). Thin transport adapter, built from the `handle()` combinator:
// resolve the actor (no provisioning on a read) → list via the FolderRepository
// → serialize through the pure arp-http mapper. The flat list carries
// parent_id so a client can rebuild the tree.
import { createFolder, listFolders } from "arp-application";
import { makeFolderId } from "arp-domain";
import { createFolderToHttp, listFoldersToHttp } from "arp-http";
import { deps, folderRepo } from "../server/container.server";
import { handle } from "../server/handle.server";
import { parseCursorParams, wireContext } from "../server/http.server";

// GET /api/v1/folders — cursor-paginated folder list (ADR-0053): `limit`,
// `starting_after`/`ending_before` (a folder_ id). parent_id links the tree.
export const loader = handle({
  mode: "read",
  run: ({ args, actor }) => {
    const cursor = parseCursorParams(new URL(args.request.url).searchParams, makeFolderId);
    if (!cursor.ok) return cursor; // malformed cursor → 422
    return listFolders({ folders: folderRepo() }, { orgId: actor.orgId }, cursor.value);
  },
  toHttp: (result) => listFoldersToHttp(result, wireContext()),
});

// POST /api/v1/folders — create a folder under parent_id (ADR-0036). Write path
// → resolveUploadActor (provisions). createFolder validates the parent exists,
// is in the actor's org, and the depth limit; the Root has no parent so a
// top-level folder still nests under it (parent_id required).
export const action = handle({
  mode: "write",
  parseBody: true,
  run: ({ actor, body }) => {
    const name = typeof body.name === "string" ? body.name : "";
    const rawParent = typeof body.parent_id === "string" ? body.parent_id.trim() : "";
    // Decode the parent folder_ External Id at the boundary → 422 (a bad value would
    // otherwise throw in Postgres and surface as a 500). makeFolderId rejects a bare
    // uuid / wrong prefix / "" (required), ADR-0052.
    const parentId = makeFolderId(rawParent);
    if (!parentId.ok) return parentId;

    return createFolder(
      { folders: folderRepo(), ids: deps().ids },
      { orgId: actor.orgId },
      { parentId: parentId.value, name },
    );
  },
  toHttp: (result) => createFolderToHttp(result, wireContext()),
});
