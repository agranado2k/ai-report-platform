// GET    /api/v1/reports/{slug} — fetch one report (summary), org-scoped.
// PATCH  /api/v1/reports/{slug} — rename a report (title).
// DELETE /api/v1/reports/{slug} — soft-delete a report (viewer then 410).
// Thin transport adapter (ADR-0038), built from the `handle()` combinator: it
// resolves the actor (read path → no provision; write path → provisions) + the
// slug, runs the use case, and serializes via the pure arp-http mappers. The use
// cases own authz: GET is org-scoped; PATCH/DELETE are ownership-gated (ADR-0059).
import type { ActionFunctionArgs } from "@remix-run/node";
import { deleteReport, getReport, renameReport } from "arp-application";
import { methodNotAllowed } from "arp-domain";
import { deleteReportToHttp, errorToHttp, getReportToHttp, renameReportToHttp } from "arp-http";
import { deps } from "../server/container.server";
import { handle } from "../server/handle.server";
import { toResponse, wireContext } from "../server/http.server";

// GET — read a single report by slug, scoped to the acting org. resolveActorForRead
// resolves the org WITHOUT provisioning (GETs stay safe); no session / no org → 401.
// A report outside the actor's org reads as NotAllowed (the use case owns authz).
export const loader = handle({
  mode: "read",
  slug: true,
  run: ({ actor, slug }) =>
    getReport({ reports: deps().reports }, { orgId: actor.orgId }, { slug }),
  toHttp: (result) => getReportToHttp(result, wireContext()),
});

export async function action(args: ActionFunctionArgs) {
  const method = args.request.method.toUpperCase();
  if (method === "DELETE") return deleteHandler(args);
  if (method === "PATCH") return patchHandler(args);

  return toResponse(errorToHttp(methodNotAllowed("PATCH, DELETE")));
}

const deleteHandler = handle({
  mode: "write",
  slug: true,
  run: ({ actor, slug }) =>
    deleteReport(
      { reports: deps().reports },
      { orgId: actor.orgId, userId: actor.userId },
      { slug },
    ),
  toHttp: (result) => deleteReportToHttp(result),
});

const patchHandler = handle({
  mode: "write",
  slug: true,
  parseBody: true,
  run: ({ actor, slug, body }) => {
    const title = typeof body.title === "string" ? body.title : "";
    return renameReport(
      { reports: deps().reports },
      { orgId: actor.orgId, userId: actor.userId },
      { slug, title },
    );
  },
  toHttp: (result) => renameReportToHttp(result, wireContext()),
});
