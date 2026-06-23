// POST /api/v1/reports/{slug}/move — move a report into a different folder
// (ADR-0036, Reports & Folders). Thin transport adapter: resolve the actor
// (write path → provisions) → parse { folder_id } → run moveReport → serialize
// via the pure arp-http mapper. The use case validates that the report and the
// target folder both belong to the actor's org.
import type { ActionFunctionArgs } from "@remix-run/node";
import { moveReport } from "arp-application";
import { makeFolderId } from "arp-domain";
import { errorToHttp, moveReportToHttp, parseJsonBody } from "arp-http";
import { resolveUploadActor } from "../server/auth.server";
import { deps, folderRepo } from "../server/container.server";
import { toResponse, wireContext } from "../server/http.server";
import { resolveReportSlug } from "../server/report-handle.server";

export async function action(args: ActionFunctionArgs) {
  const actor = await resolveUploadActor(args);
  if (!actor.ok) return toResponse(errorToHttp(actor.error)); // 401 / 500 per kind

  const slug = await resolveReportSlug(String(args.params.slug ?? ""), deps().reports);
  if (!slug.ok) return toResponse(errorToHttp(slug.error));

  const body = await parseJsonBody(args.request);
  if (!body.ok) return toResponse(errorToHttp(body.error));
  const rawTo = typeof body.value.folder_id === "string" ? body.value.folder_id.trim() : "";
  // Decode the target folder External Id at the boundary → 422; a bad value must
  // not reach the DB (a non-uuid throws there and surfaces as a 500).
  const toFolderId = makeFolderId(rawTo);
  if (!toFolderId.ok) return toResponse(errorToHttp(toFolderId.error));

  const result = await moveReport(
    { reports: deps().reports, folders: folderRepo() },
    { orgId: actor.value.orgId },
    { slug: slug.value, toFolderId: toFolderId.value },
  );
  return toResponse(moveReportToHttp(result, wireContext()));
}
