// GET /api/v1/folders — list the acting org's folders (ADR-0036, Reports &
// Folders). Thin transport adapter: resolve the actor (no provisioning on a
// read) → list via the FolderRepository → serialize through the pure arp-http
// mapper. The flat list carries parent_id so a client can rebuild the tree.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { createFolder } from "arp-application";
import { makeFolderId } from "arp-domain";
import { createFolderToHttp, errorToHttp, listFoldersToHttp, parseJsonBody } from "arp-http";
import { resolveActorForRead, resolveUploadActor } from "../server/auth.server";
import { deps, folderRepo } from "../server/container.server";
import { parseCursorParams, toResponse, unauthenticated, wireContext } from "../server/http.server";

// GET /api/v1/folders — cursor-paginated folder list (ADR-0053): `limit`,
// `starting_after`/`ending_before` (a folder_ id). parent_id links the tree.
export async function loader(args: LoaderFunctionArgs) {
  const actor = await resolveActorForRead(args);
  if (!actor.ok) return toResponse(errorToHttp(actor.error)); // infra failure → 500
  if (!actor.value) return toResponse(unauthenticated()); // no session / no org → 401
  const cursor = parseCursorParams(new URL(args.request.url).searchParams, makeFolderId);
  if (!cursor.ok) return toResponse(errorToHttp(cursor.error)); // malformed cursor → 422
  const result = await folderRepo().searchByOrg(actor.value.orgId, cursor.value);
  return toResponse(listFoldersToHttp(result, wireContext()));
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
  // Decode the parent folder_ External Id at the boundary → 422 (a bad value would
  // otherwise throw in Postgres and surface as a 500). makeFolderId rejects a bare
  // uuid / wrong prefix / "" (required), ADR-0052.
  const parentId = makeFolderId(rawParent);
  if (!parentId.ok) return toResponse(errorToHttp(parentId.error));

  const created = await createFolder(
    { folders: folderRepo(), ids: deps().ids },
    { orgId: actor.value.orgId },
    { parentId: parentId.value, name },
  );
  return toResponse(createFolderToHttp(created, wireContext()));
}
