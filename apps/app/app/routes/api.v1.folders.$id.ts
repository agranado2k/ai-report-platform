// PATCH /api/v1/folders/{id} — rename a folder.
// DELETE /api/v1/folders/{id} — delete a folder (blocked if non-empty).
// Thin transport adapter (ADR-0036), built from the `handle()` combinator:
// resolve the actor (write path → provisions) → validate the id → dispatch on
// method → run the use case → serialize via the pure arp-http mappers. The use
// cases own all authz + the not-empty / not-Root invariants.
import type { ActionFunctionArgs } from "@remix-run/node";
import { deleteFolder, renameFolder } from "arp-application";
import { makeFolderId, methodNotAllowed } from "arp-domain";
import { deleteFolderToHttp, errorToHttp, renameFolderToHttp } from "arp-http";
import { deps, folderRepo } from "../server/container.server";
import { handle } from "../server/handle.server";
import { toResponse, wireContext } from "../server/http.server";

export async function action(args: ActionFunctionArgs) {
  const method = args.request.method.toUpperCase();
  if (method === "DELETE") return deleteHandler(args);
  if (method === "PATCH") return patchHandler(args);

  return toResponse(errorToHttp(methodNotAllowed("PATCH, DELETE")));
}

const deleteHandler = handle({
  mode: "write",
  run: ({ args, actor }) => {
    const id = makeFolderId(String(args.params.id ?? ""));
    if (!id.ok) return id;
    return deleteFolder(
      { folders: folderRepo(), reports: deps().reports },
      { orgId: actor.orgId },
      { folderId: id.value },
    );
  },
  toHttp: (result) => deleteFolderToHttp(result),
});

const patchHandler = handle({
  mode: "write",
  parseBody: true,
  run: ({ args, actor, body }) => {
    const id = makeFolderId(String(args.params.id ?? ""));
    if (!id.ok) return id;
    const name = typeof body.name === "string" ? body.name : "";
    return renameFolder({ folders: folderRepo() }, { orgId: actor.orgId }, { folderId: id.value, name });
  },
  toHttp: (result) => renameFolderToHttp(result, wireContext()),
});
