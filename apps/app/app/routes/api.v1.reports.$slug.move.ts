// POST /api/v1/reports/{slug}/move — move a report into a different folder
// (ADR-0036, Reports & Folders). Thin transport adapter, built from the
// `handle()` combinator: resolve the actor (write path → provisions) + the
// slug → parse { folder_id } → run moveReport → serialize via the pure
// arp-http mapper. The use case validates that the report and the target
// folder both belong to the actor's org.
import { moveReport } from "arp-application";
import { makeFolderId } from "arp-domain";
import { moveReportToHttp } from "arp-http";
import { deps, folderRepo } from "../server/container.server";
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
      { reports: deps().reports, folders: folderRepo() },
      { orgId: actor.orgId },
      { slug, toFolderId: toFolderId.value },
    );
  },
  toHttp: (result) => moveReportToHttp(result, wireContext()),
});
