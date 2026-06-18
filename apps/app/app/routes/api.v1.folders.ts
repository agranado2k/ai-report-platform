// GET /api/v1/folders — list the acting org's folders (ADR-0036, Reports &
// Folders). Thin transport adapter: resolve the actor (no provisioning on a
// read) → list via the FolderRepository → serialize through the pure arp-http
// mapper. The flat list carries parent_id so a client can rebuild the tree.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { createFolder } from "arp-application";
import { folderId } from "arp-domain";
import { createFolderToHttp, errorToHttp, listFoldersToHttp } from "arp-http";
import { resolveActorForRead, resolveUploadActor } from "../server/auth.server";
import { deps, folderRepo } from "../server/container.server";
import { parseJsonBody, toResponse, unauthenticated } from "../server/http.server";

export async function loader(args: LoaderFunctionArgs) {
  const actor = await resolveActorForRead(args);
  if (!actor.ok) return toResponse(errorToHttp(actor.error)); // infra failure → 500
  if (!actor.value) return toResponse(unauthenticated()); // no session / no org → 401
  const result = await folderRepo().listByOrg(actor.value.orgId);
  return toResponse(listFoldersToHttp(result));
}

// POST /api/v1/folders — create a folder under parent_id (ADR-0036). Write path
// → resolveUploadActor (provisions). createFolder validates the parent exists,
// is in the actor's org, and the depth limit; the Root has no parent so a
// top-level folder still nests under it (parent_id required).
export async function action(args: ActionFunctionArgs) {
  const actor = await resolveUploadActor(args);
  if (!actor.ok) return toResponse(errorToHttp(actor.error)); // 401 / 500 per kind

  const body = await parseJsonBody(args.request);
  if (!body.ok) return toResponse(errorToHttp(body.error));
  const name = typeof body.value.name === "string" ? body.value.name : "";
  const rawParent = typeof body.value.parent_id === "string" ? body.value.parent_id.trim() : "";
  if (!rawParent) {
    return toResponse(
      errorToHttp({
        kind: "ValidationError",
        message: "parent_id is required",
        field: "parent_id",
      }),
    );
  }

  const result = await createFolder(
    { folders: folderRepo(), ids: deps().ids },
    { orgId: actor.value.orgId },
    { parentId: folderId(rawParent), name },
  );
  return toResponse(createFolderToHttp(result));
}
