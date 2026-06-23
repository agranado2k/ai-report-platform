// POST /api/v1/reports — the production upload API (ADR-0037, ADR-0039, ADR-0040).
// Thin transport adapter: resolve the actor (auth seam) → parse the multipart
// body + Idempotency-Key → run the UploadReportUseCase → serialize via the pure
// arp-http mapper. All policy lives in the application/domain; this file only
// translates HTTP ⇆ use-case Result and never throws a bare error to the client.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { searchReports, type UploadActor, uploadReport } from "arp-application";
import { err, type FolderId, makeFolderId, makeReportId } from "arp-domain";
import { errorToHttp, searchReportsToHttp, uploadResultToHttp } from "arp-http";
import { resolveActorForRead, resolveUploadActor } from "../server/auth.server";
import { deps, viewOrigin } from "../server/container.server";
import { parseCursorParams, toResponse, unauthenticated, wireContext } from "../server/http.server";

// GET /api/v1/reports — the acting org's reports, newest-created-first, **cursor
// paginated + searchable** (ADR-0036, ADR-0053). Query params: `q` (title/slug),
// `folder_id` (filter), `limit`, `starting_after`/`ending_before` (a report_ id).
// resolveActorForRead resolves the org WITHOUT provisioning; no session/org → 401.
export async function loader(args: LoaderFunctionArgs) {
  const actor = await resolveActorForRead(args);
  if (!actor.ok) return toResponse(errorToHttp(actor.error)); // infra failure → 500
  if (!actor.value) return toResponse(unauthenticated()); // no session / no org → 401

  const url = new URL(args.request.url);
  const query = url.searchParams.get("q")?.trim() || undefined;
  const cursor = parseCursorParams(url.searchParams, makeReportId);
  if (!cursor.ok) return toResponse(errorToHttp(cursor.error)); // malformed cursor → 422

  let folderId: FolderId | undefined;
  const rawFolder = url.searchParams.get("folder_id")?.trim();
  if (rawFolder) {
    const parsed = makeFolderId(rawFolder);
    if (!parsed.ok) return toResponse(errorToHttp(parsed.error)); // malformed id → 422
    folderId = parsed.value;
  }

  const result = await searchReports(
    { reports: deps().reports },
    { orgId: actor.value.orgId },
    { query, folderId, ...cursor.value },
  );
  return toResponse(searchReportsToHttp(result, wireContext()));
}

export async function action(args: ActionFunctionArgs) {
  const { request } = args;
  if (request.method !== "POST") {
    return toResponse({
      status: 405,
      contentType: "application/problem+json",
      body: {
        type: "about:blank",
        title: "Method not allowed",
        status: 405,
        detail: "POST /api/v1/reports",
        code: "method_not_allowed",
      },
      headers: { Allow: "POST" },
    });
  }

  // The report is served on the PSL-isolated view origin (ADR-002 / ADR-0038):
  // view_url = `${viewBaseUrl}/${slug}`. The composition root owns env access
  // (ADR-0043) — canonical VIEW_ORIGIN on prod, request-origin fallback on previews.
  const opts = { viewBaseUrl: viewOrigin(request), mode: wireContext().mode };

  // 1. Resolve the acting principal — requires a signed-in Clerk session
  //    (ADR-0048); unauthenticated → 401. resolveUploadActor provisions the
  //    user's identity (User + personal Org + Root folder) on first sight.
  const actorResult = await resolveUploadActor(args);
  if (!actorResult.ok) return toResponse(uploadResultToHttp(actorResult, opts));
  const actor = actorResult.value;

  // 2. Parse the multipart request into an UploadCommand.
  const commandResult = await parseUploadCommand(request, actor);
  if (!commandResult.ok) return toResponse(uploadResultToHttp(commandResult, opts));

  // 3. Run the use case against the real adapters. The version is committed as
  //    `pending`; promotion happens asynchronously when the scan drain processes
  //    it (ADR-0045) — the 201 truthfully returns scan_status: pending, and the
  //    viewer shows the holding page until the drain promotes the clean version.
  const result = await uploadReport(deps(), commandResult.value);

  return toResponse(uploadResultToHttp(result, opts));
}

/** Map the multipart form into an UploadCommand, or a client error. */
async function parseUploadCommand(request: Request, actor: UploadActor) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return err({
      kind: "UnsupportedMediaType" as const,
      message: "expected multipart/form-data with a 'file' part",
    });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return err({ kind: "ValidationError" as const, message: "malformed multipart body" });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return err({ kind: "ValidationError" as const, message: "missing 'file' part", field: "file" });
  }

  const updateSlug = strOrUndefined(form.get("update_slug"));
  const folderPath = strOrUndefined(form.get("folder_path"));

  // `folder_path` is create-only — placing a re-upload in a folder is rejected
  // (the slug already owns its location). ADR-0037 / openapi.
  if (updateSlug && folderPath) {
    return err({
      kind: "ValidationError" as const,
      message: "folder_path cannot be set on re-upload (it is create-only)",
      field: "folder_path",
    });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const idempotencyKey = strOrUndefined(request.headers.get("Idempotency-Key"));

  return {
    ok: true as const,
    value: {
      actor,
      upload: { filename: file.name || "index.html", bytes },
      ...(updateSlug ? { updateSlug } : {}),
      ...(idempotencyKey ? { idempotencyKey } : {}),
    },
  };
}

function strOrUndefined(v: FormDataEntryValue | string | null): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}
