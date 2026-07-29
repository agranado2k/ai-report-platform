// GET    /api/v1/reports/{slug} — fetch one report (summary), org-scoped.
// PATCH  /api/v1/reports/{slug} — rename a report (title).
// DELETE /api/v1/reports/{slug} — soft-delete a report (viewer then 410).
// Thin transport adapter over the deepened `handle()` seam + `ops()` (ADR-0038):
// the seam resolves the actor + slug + Idempotency-Key (ADR-0039) and
// dispatches the verb; the use cases own authz (GET org-scoped; PATCH/DELETE
// ownership-gated, ADR-0059).
import { deleteReportToHttp, getReportToHttp, renameReportToHttp } from "arp-http";
import { ops } from "../server/container.server";
import { handle, methods } from "../server/handle.server";
import { wireContext } from "../server/http.server";

// GET — org-visible, PLUS the cross-org write-grantee metadata carve-out
// (ADR-0060 §4). A report neither in the actor's org nor write-granted to them
// reads as NotAllowed (the use case owns authz).
export const loader = handle({
  mode: "read",
  slug: true,
  run: ({ actor, slug }) => ops().getReport({ orgId: actor.orgId, userId: actor.userId }, { slug }),
  // The acl block is owner-conditional (ADR-0059 §3) — thread the viewer through.
  toHttp: (result, { actor }) => getReportToHttp(result, wireContext(), { userId: actor.userId }),
});

export const action = methods({
  PATCH: handle({
    mode: "write",
    slug: true,
    parseBody: true,
    run: ({ actor, slug, body, idempotencyKey }) =>
      ops().renameReport(
        { orgId: actor.orgId, userId: actor.userId },
        { slug, title: typeof body.title === "string" ? body.title : "", idempotencyKey },
      ),
    toHttp: (result, { actor }) =>
      renameReportToHttp(result, wireContext(), { userId: actor.userId }),
  }),
  DELETE: handle({
    mode: "write",
    slug: true,
    run: ({ actor, slug, idempotencyKey }) =>
      ops().deleteReport({ orgId: actor.orgId, userId: actor.userId }, { slug, idempotencyKey }),
    toHttp: (result) => deleteReportToHttp(result),
  }),
});
