// GET /api/v1/folders — list the acting org's folders (ADR-0036, Reports &
// Folders). Thin transport adapter: resolve the actor (no provisioning on a
// read) → list via the FolderRepository → serialize through the pure arp-http
// mapper. The flat list carries parent_id so a client can rebuild the tree.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { errorToHttp, listFoldersToHttp } from "arp-http";
import { resolveActorForRead } from "../server/auth.server";
import { folderRepo } from "../server/container.server";
import { toResponse } from "../server/http.server";

export async function loader(args: LoaderFunctionArgs) {
  const actor = await resolveActorForRead(args);
  if (!actor) {
    return toResponse(
      errorToHttp({
        kind: "Unauthenticated",
        message: "a signed-in session with an active organization is required",
      }),
    );
  }
  const result = await folderRepo().listByOrg(actor.orgId);
  return toResponse(listFoldersToHttp(result));
}
