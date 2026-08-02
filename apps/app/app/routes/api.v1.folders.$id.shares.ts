// GET  /api/v1/folders/{id}/shares — list everyone a folder is shared with
// (ADR-0076). OWNER-OR-LEGACY only + the `acl:write` scope — share config is
// the owner's business (mirrors GET /reports/{slug}/write-grants, ADR-0060).
// POST /api/v1/folders/{id}/shares — share the folder's VISIBILITY with a
// person by email (never write — folder writes stay owner-or-org). Same gate.
// Thin transport adapter over the deepened `handle()` seam + `ops()`; the use
// cases own the authz.
import { makeFolderId } from "arp-domain";
import { listFolderSharesToHttp, shareFolderToHttp } from "arp-http";
import { ops } from "../server/container.server";
import { handle, methods } from "../server/handle.server";

export const loader = handle({
  mode: "read",
  run: ({ args, actor }) => {
    const id = makeFolderId(String(args.params.id ?? ""));
    if (!id.ok) return id;
    return ops().listFolderShares(
      { orgId: actor.orgId, userId: actor.userId, scopes: actor.scopes },
      { folderId: id.value },
    );
  },
  toHttp: (result) => listFolderSharesToHttp(result),
});

export const action = methods({
  POST: handle({
    mode: "write",
    parseBody: true,
    run: ({ args, actor, body, idempotencyKey }) => {
      const id = makeFolderId(String(args.params.id ?? ""));
      if (!id.ok) return id;
      return ops().shareFolder(
        { orgId: actor.orgId, userId: actor.userId, scopes: actor.scopes },
        {
          folderId: id.value,
          email: typeof body.email === "string" ? body.email : "",
          idempotencyKey,
        },
      );
    },
    toHttp: (result) => shareFolderToHttp(result),
  }),
});
