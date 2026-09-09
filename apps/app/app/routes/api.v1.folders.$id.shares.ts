// GET  /api/v1/folders/{id}/shares — list everyone a folder is shared with
// (ADR-0076). OWNER-OR-LEGACY only + the `acl:write` scope — share config is
// the owner's business (mirrors GET /reports/{slug}/write-grants, ADR-0060).
//
//   ?include=manage (ADR-0087) — the LAZY management payload the content-header
//   panel loads on "Manage ▾": the roster PLUS the bulk-apply context and the
//   badge/form-key recomputed with the real roster count. Same authorization
//   (the roster read IS the gate); additive, so a plain `GET /shares` is
//   unchanged for every other caller.
//
// POST /api/v1/folders/{id}/shares — share the folder's VISIBILITY with a
// person by email (never write — folder writes stay owner-or-org). Same gate.
// Thin transport adapter over the deepened `handle()` seam + `ops()`; the use
// cases own the authz.
import { type AppError, makeFolderId, type Result } from "arp-domain";
import { errorToHttp, type HttpResponse, listFolderSharesToHttp, shareFolderToHttp } from "arp-http";
import type { FolderShare } from "arp-application";
import { ops } from "../server/container.server";
import {
  type FolderManageContext,
  loadFolderManageContext,
} from "../server/folder-sharing.server";
import { handle, methods } from "../server/handle.server";

/** The `?include=manage` success body — the panel reads it straight off
 *  `fetcher.data`. Tagged like every other resource envelope on this API. */
function manageContextToHttp(result: Result<FolderManageContext, AppError>): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  return {
    status: 200,
    contentType: "application/json",
    body: { object: "folder_manage_context", ...result.value },
  };
}

export const loader = handle<readonly FolderShare[] | FolderManageContext>({
  mode: "read",
  run: ({ args, actor, url }) => {
    const id = makeFolderId(String(args.params.id ?? ""));
    if (!id.ok) return id;
    if (url.searchParams.get("include") === "manage") {
      return loadFolderManageContext(ops(), actor, id.value);
    }
    return ops().listFolderShares(
      { orgId: actor.orgId, userId: actor.userId, scopes: actor.scopes },
      { folderId: id.value },
    );
  },
  toHttp: (result, ctx) =>
    ctx.url.searchParams.get("include") === "manage"
      ? manageContextToHttp(result as Result<FolderManageContext, AppError>)
      : listFolderSharesToHttp(result as Result<readonly FolderShare[], AppError>),
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
