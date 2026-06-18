// PATCH /api/v1/folders/{id} — rename a folder.
// DELETE /api/v1/folders/{id} — delete a folder (blocked if non-empty).
// Thin transport adapter (ADR-0036): resolve the actor (write path → provisions)
// → validate the id → dispatch on method → run the use case → serialize via the
// pure arp-http mappers. The use cases own all authz + the not-empty / not-Root
// invariants.
import type { ActionFunctionArgs } from "@remix-run/node";
import { deleteFolder, renameFolder } from "arp-application";
import { makeFolderId } from "arp-domain";
import { deleteFolderToHttp, errorToHttp, parseJsonBody, renameFolderToHttp } from "arp-http";
import { resolveUploadActor } from "../server/auth.server";
import { deps, folderRepo } from "../server/container.server";
import { toResponse } from "../server/http.server";

export async function action(args: ActionFunctionArgs) {
  const actor = await resolveUploadActor(args);
  if (!actor.ok) return toResponse(errorToHttp(actor.error)); // 401 / 500 per kind

  const id = makeFolderId(String(args.params.id ?? ""));
  if (!id.ok) return toResponse(errorToHttp(id.error));
  const orgId = actor.value.orgId;
  const method = args.request.method.toUpperCase();

  if (method === "DELETE") {
    const result = await deleteFolder(
      { folders: folderRepo(), reports: deps().reports },
      { orgId },
      { folderId: id.value },
    );
    return toResponse(deleteFolderToHttp(result));
  }

  if (method === "PATCH") {
    const body = await parseJsonBody(args.request);
    if (!body.ok) return toResponse(errorToHttp(body.error));
    const name = typeof body.value.name === "string" ? body.value.name : "";
    const result = await renameFolder(
      { folders: folderRepo() },
      { orgId },
      { folderId: id.value, name },
    );
    return toResponse(renameFolderToHttp(result));
  }

  return toResponse({
    status: 405,
    contentType: "application/problem+json",
    body: {
      type: "about:blank",
      title: "Method not allowed",
      status: 405,
      detail: "use PATCH to rename or DELETE to remove a folder",
      code: "method_not_allowed",
    },
    headers: { Allow: "PATCH, DELETE" },
  });
}
