// POST /api/v1/reports/{slug}/move — move a report into a different folder
// (ADR-0036, Reports & Folders). Thin transport adapter: resolve the actor
// (write path → provisions) → parse { folder_id } → run moveReport → serialize
// via the pure arp-http mapper. The use case validates that the report and the
// target folder both belong to the actor's org.
import type { ActionFunctionArgs } from "@remix-run/node";
import { moveReport } from "arp-application";
import { folderId, makeSlug } from "arp-domain";
import { errorToHttp, moveReportToHttp } from "arp-http";
import { resolveUploadActor } from "../server/auth.server";
import { deps, folderRepo } from "../server/container.server";
import { parseJsonBody, toResponse } from "../server/http.server";

export async function action(args: ActionFunctionArgs) {
  const actor = await resolveUploadActor(args);
  if (!actor.ok) return toResponse(errorToHttp(actor.error)); // 401 / 500 per kind

  const slug = makeSlug(String(args.params.slug ?? ""));
  if (!slug.ok) return toResponse(errorToHttp(slug.error));

  const body = await parseJsonBody(args.request);
  if (!body.ok) return toResponse(errorToHttp(body.error));
  const rawTo = typeof body.value.folder_id === "string" ? body.value.folder_id.trim() : "";
  if (!rawTo) {
    return toResponse(
      errorToHttp({
        kind: "ValidationError",
        message: "folder_id is required",
        field: "folder_id",
      }),
    );
  }

  const toFolderId = folderId(rawTo); // moveReport validates it's in the actor's org
  const result = await moveReport(
    { reports: deps().reports, folders: folderRepo() },
    { orgId: actor.value.orgId },
    { slug: slug.value, toFolderId },
  );
  return toResponse(moveReportToHttp(result, { slug: slug.value, folderId: toFolderId }));
}
