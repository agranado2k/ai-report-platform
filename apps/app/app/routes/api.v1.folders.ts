// GET  /api/v1/folders — list the acting org's folders (ADR-0036, Reports &
// Folders), cursor-paginated (ADR-0053); parent_id links the tree.
// POST /api/v1/folders — create a folder under parent_id.
// Thin transport adapter over the deepened `handle()` seam + `ops()`: this
// file keeps only its unique parsing (the cursor params, the parent_id
// decode); actor resolution, the Idempotency-Key header (ADR-0039), method
// dispatch (a stray PATCH/DELETE now 405s instead of running create), and
// wiring live on the seam.
import { makeFolderId } from "arp-domain";
import { createFolderToHttp, listFoldersToHttp, parseCursorParams } from "arp-http";
import { ops } from "../server/container.server";
import { handle, methods } from "../server/handle.server";
import { wireContext } from "../server/http.server";

export const loader = handle({
  mode: "read",
  run: ({ url, actor }) => {
    const cursor = parseCursorParams(url.searchParams, makeFolderId);
    if (!cursor.ok) return cursor; // malformed cursor → 422
    return ops().listFolders({ orgId: actor.orgId }, cursor.value);
  },
  toHttp: (result) => listFoldersToHttp(result, wireContext()),
});

// createFolder validates the parent exists, is in the actor's org, and the
// depth limit; the Root has no parent so a top-level folder still nests under
// it (parent_id required).
export const action = methods({
  POST: handle({
    mode: "write",
    parseBody: true,
    run: ({ actor, body, idempotencyKey }) => {
      const name = typeof body.name === "string" ? body.name : "";
      const rawParent = typeof body.parent_id === "string" ? body.parent_id.trim() : "";
      // Decode the parent folder_ External Id at the boundary → 422 (a bad value
      // would otherwise throw in Postgres and surface as a 500), ADR-0052.
      const parentId = makeFolderId(rawParent);
      if (!parentId.ok) return parentId;

      return ops().createFolder(
        { orgId: actor.orgId, userId: actor.userId },
        { parentId: parentId.value, name, idempotencyKey },
      );
    },
    toHttp: (result) => createFolderToHttp(result, wireContext()),
  }),
});
