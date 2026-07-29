// PATCH  /api/v1/folders/{id} — rename a folder.
// DELETE /api/v1/folders/{id} — delete a folder (blocked if non-empty).
// Thin transport adapter over the deepened `handle()` seam + `ops()`
// (ADR-0036): the seam resolves the actor + Idempotency-Key (ADR-0039) and
// dispatches the verb; this file keeps only the folder-id decode. The use
// cases own all authz + the not-empty / not-Root invariants.
import { makeFolderId } from "arp-domain";
import { deleteFolderToHttp, renameFolderToHttp } from "arp-http";
import { ops } from "../server/container.server";
import { handle, methods } from "../server/handle.server";
import { wireContext } from "../server/http.server";

export const action = methods({
  PATCH: handle({
    mode: "write",
    parseBody: true,
    run: ({ args, actor, body, idempotencyKey }) => {
      const id = makeFolderId(String(args.params.id ?? ""));
      if (!id.ok) return id;
      const name = typeof body.name === "string" ? body.name : "";
      return ops().renameFolder(
        { orgId: actor.orgId, userId: actor.userId },
        { folderId: id.value, name, idempotencyKey },
      );
    },
    toHttp: (result) => renameFolderToHttp(result, wireContext()),
  }),
  DELETE: handle({
    mode: "write",
    run: ({ args, actor, idempotencyKey }) => {
      const id = makeFolderId(String(args.params.id ?? ""));
      if (!id.ok) return id;
      return ops().deleteFolder(
        { orgId: actor.orgId, userId: actor.userId },
        { folderId: id.value, idempotencyKey },
      );
    },
    toHttp: (result) => deleteFolderToHttp(result),
  }),
});
