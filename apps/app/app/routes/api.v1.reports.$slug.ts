// GET    /api/v1/reports/{slug} — fetch one report (summary), org-scoped.
// PATCH  /api/v1/reports/{slug} — rename a report (title).
// DELETE /api/v1/reports/{slug} — soft-delete a report (viewer then 410).
// Thin transport adapter (ADR-0038): resolve the actor (read path → no provision;
// write path → provisions) → validate the slug → run the use case → serialize via
// the pure arp-http mappers. The use cases own org-ownership authz.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { deleteReport, getReport, renameReport } from "arp-application";
import { makeSlug } from "arp-domain";
import {
  deleteReportToHttp,
  errorToHttp,
  getReportToHttp,
  parseJsonBody,
  renameReportToHttp,
} from "arp-http";
import { resolveActorForRead, resolveUploadActor } from "../server/auth.server";
import { deps } from "../server/container.server";
import { toResponse, unauthenticated } from "../server/http.server";

// GET — read a single report by slug, scoped to the acting org. resolveActorForRead
// resolves the org WITHOUT provisioning (GETs stay safe); no session / no org → 401.
// A report outside the actor's org reads as NotAllowed (the use case owns authz).
export async function loader(args: LoaderFunctionArgs) {
  const actor = await resolveActorForRead(args);
  if (!actor.ok) return toResponse(errorToHttp(actor.error)); // infra failure → 500
  if (!actor.value) return toResponse(unauthenticated()); // no session / no org → 401

  const slug = makeSlug(String(args.params.slug ?? ""));
  if (!slug.ok) return toResponse(errorToHttp(slug.error));

  const result = await getReport(
    { reports: deps().reports },
    { orgId: actor.value.orgId },
    { slug: slug.value },
  );
  return toResponse(getReportToHttp(result));
}

export async function action(args: ActionFunctionArgs) {
  const actor = await resolveUploadActor(args);
  if (!actor.ok) return toResponse(errorToHttp(actor.error)); // 401 / 500 per kind

  const slug = makeSlug(String(args.params.slug ?? ""));
  if (!slug.ok) return toResponse(errorToHttp(slug.error));
  const orgId = actor.value.orgId;
  const method = args.request.method.toUpperCase();

  if (method === "DELETE") {
    const result = await deleteReport({ reports: deps().reports }, { orgId }, { slug: slug.value });
    return toResponse(deleteReportToHttp(result));
  }

  if (method === "PATCH") {
    const body = await parseJsonBody(args.request);
    if (!body.ok) return toResponse(errorToHttp(body.error));
    const title = typeof body.value.title === "string" ? body.value.title : "";
    const result = await renameReport(
      { reports: deps().reports },
      { orgId },
      { slug: slug.value, title },
    );
    return toResponse(renameReportToHttp(result));
  }

  return toResponse({
    status: 405,
    contentType: "application/problem+json",
    body: {
      type: "about:blank",
      title: "Method not allowed",
      status: 405,
      detail: "use PATCH to rename or DELETE to remove a report",
      code: "method_not_allowed",
    },
    headers: { Allow: "PATCH, DELETE" },
  });
}
