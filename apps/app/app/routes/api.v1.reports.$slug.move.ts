// POST /api/v1/reports/{slug}/move — move a report into a different folder
// (ADR-0036, Reports & Folders). Thin transport adapter, built from the
// `handle()` combinator: resolve the actor (write path → provisions) + the
// slug → parse { folder_id } → run moveReport → serialize via the pure
// arp-http mapper. The use case owns authz: the actor must pass the canWrite
// seam for the report (owner OR write-grantee, ADR-0059/0060) and the target
// folder must be in the report's org.
import { moveReport } from "arp-application";
import { makeFolderId } from "arp-domain";
import { moveReportToHttp } from "arp-http";
import { deps, folderRepo, identityStore, writeGrantStore } from "../server/container.server";
import { handle } from "../server/handle.server";
import { wireContext } from "../server/http.server";

export const action = handle({
  mode: "write",
  slug: true,
  parseBody: true,
  run: ({ actor, slug, body }) => {
    const rawTo = typeof body.folder_id === "string" ? body.folder_id.trim() : "";
    // Decode the target folder External Id at the boundary → 422; a bad value must
    // not reach the DB (a non-uuid throws there and surfaces as a 500).
    const toFolderId = makeFolderId(rawTo);
    if (!toFolderId.ok) return toFolderId;

    return moveReport(
      {
        reports: deps().reports,
        folders: folderRepo(),
        grants: writeGrantStore(),
        identities: identityStore(),
      },
      { orgId: actor.orgId, userId: actor.userId },
      { slug, toFolderId: toFolderId.value },
    );
  },
  toHttp: (result, { actor }) => moveReportToHttp(result, wireContext(), { userId: actor.userId }),
});
