// GET /api/v1/folders — list the acting org's folders (ADR-0036, Reports &
// Folders). Thin transport adapter: resolve the actor (no provisioning on a
// read) → list via the FolderRepository → serialize through the pure arp-http
// mapper. The flat list carries parent_id so a client can rebuild the tree.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { errorToHttp, listFoldersToHttp } from "arp-http";
import { resolveActorForRead } from "../server/auth.server";
import { folderRepo } from "../server/container.server";
import { toResponse, unauthenticated } from "../server/http.server";

export async function loader(args: LoaderFunctionArgs) {
  const actor = await resolveActorForRead(args);
  if (!actor.ok) return toResponse(errorToHttp(actor.error)); // infra failure → 500
  if (!actor.value) return toResponse(unauthenticated()); // no session / no org → 401
  const result = await folderRepo().listByOrg(actor.value.orgId);
  return toResponse(listFoldersToHttp(result));
}
