// POST /api/v1/reports/{slug}/move — move a report into a different folder
// (ADR-0036, Reports & Folders). Thin transport adapter over the deepened
// `handle()` seam + `ops()`: this file keeps only the target folder_id decode;
// actor resolution, the slug, the Idempotency-Key header (ADR-0039), and
// method dispatch live on the seam. The use case owns authz: the actor must
// pass the canWrite seam for the report (owner OR write-grantee,
// ADR-0059/0060) and the target folder must be in the report's org.
import { makeFolderId } from "arp-domain";
import { moveReportToHttp } from "arp-http";
import { ops } from "../server/container.server";
import { handle, methods } from "../server/handle.server";
import { wireContext } from "../server/http.server";

export const action = methods({
  POST: handle({
    mode: "write",
    slug: true,
    parseBody: true,
    run: ({ actor, slug, body, idempotencyKey }) => {
      const rawTo = typeof body.folder_id === "string" ? body.folder_id.trim() : "";
      // Decode the target folder External Id at the boundary → 422; a bad value
      // must not reach the DB (a non-uuid throws there and surfaces as a 500).
      const toFolderId = makeFolderId(rawTo);
      if (!toFolderId.ok) return toFolderId;

      return ops().moveReport(
        { orgId: actor.orgId, userId: actor.userId },
        { slug, toFolderId: toFolderId.value, idempotencyKey },
      );
    },
    toHttp: (result, { actor }) =>
      moveReportToHttp(result, wireContext(), { userId: actor.userId }),
  }),
});
