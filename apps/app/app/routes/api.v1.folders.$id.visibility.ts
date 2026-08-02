// POST /api/v1/folders/{id}/visibility — set a folder's visibility (ADR-0076):
// `private` (owner + folder-share grantees) or `org` (every member).
// OWNER-OR-LEGACY only + the `acl:write` scope — a legacy (pre-ADR-0076,
// owner-less) folder is ADOPTED by the caller (they become its owner), which
// is the documented repair path for org-visible legacy folders. The Root is
// always `org` (422 on an attempt to make it private). Thin transport adapter
// over the deepened `handle()` seam + `ops()`; the use case owns all authz.
import {
  err,
  FOLDER_VISIBILITIES,
  type FolderVisibility,
  makeFolderId,
  validationError,
} from "arp-domain";
import { setFolderVisibilityToHttp } from "arp-http";
import { ops } from "../server/container.server";
import { handle, methods } from "../server/handle.server";
import { wireContext } from "../server/http.server";

export const action = methods({
  POST: handle({
    mode: "write",
    parseBody: true,
    run: ({ args, actor, body, idempotencyKey }) => {
      const id = makeFolderId(String(args.params.id ?? ""));
      if (!id.ok) return id;
      const rawVisibility = typeof body.visibility === "string" ? body.visibility : "";
      if (!FOLDER_VISIBILITIES.includes(rawVisibility as FolderVisibility)) {
        return err(
          validationError(
            `visibility must be one of: ${FOLDER_VISIBILITIES.join(", ")}`,
            "visibility",
          ),
        );
      }
      return ops().setFolderVisibility(
        { orgId: actor.orgId, userId: actor.userId, scopes: actor.scopes },
        {
          folderId: id.value,
          visibility: rawVisibility as FolderVisibility,
          idempotencyKey,
        },
      );
    },
    toHttp: (result) => setFolderVisibilityToHttp(result, wireContext()),
  }),
});
