// POST /api/v1/reports — the production upload API (ADR-0037, ADR-0039, ADR-0040).
// Thin transport adapter: resolve the actor (auth seam) → parse the multipart
// body + Idempotency-Key → run the UploadReportUseCase → serialize via the pure
// arp-http mapper. All policy lives in the application/domain; this file only
// translates HTTP ⇆ use-case Result and never throws a bare error to the client.
// Both loader and action are built from the `handle()` combinator (route-seam
// deepening): it owns the actor-resolution → run-use-case → map-Result →
// toResponse choreography common to every /api/v1 route.
import type { ActionFunctionArgs } from "@remix-run/node";
import { searchReports, type UploadActor, uploadReport } from "arp-application";
import { err, type FolderId, makeFolderId, makeReportId, methodNotAllowed } from "arp-domain";
import { errorToHttp, parseCursorParams, searchReportsToHttp, uploadResultToHttp } from "arp-http";
import { deps, viewOrigin } from "../server/container.server";
import { handle } from "../server/handle.server";
import { toResponse, wireContext } from "../server/http.server";

// GET /api/v1/reports — the acting org's reports, newest-created-first, **cursor
// paginated + searchable** (ADR-0036, ADR-0053). Query params: `q` (title/slug),
// `folder_id` (filter), `limit`, `starting_after`/`ending_before` (a report_ id).
// resolveActorForRead resolves the org WITHOUT provisioning; no session/org → 401.
export const loader = handle({
  mode: "read",
  run: async ({ args, actor }) => {
    const url = new URL(args.request.url);
    const query = url.searchParams.get("q")?.trim() || undefined;
    const cursor = parseCursorParams(url.searchParams, makeReportId);
    if (!cursor.ok) return cursor; // malformed cursor → 422

    let folderId: FolderId | undefined;
    const rawFolder = url.searchParams.get("folder_id")?.trim();
    if (rawFolder) {
      const parsed = makeFolderId(rawFolder);
      if (!parsed.ok) return parsed; // malformed id → 422
      folderId = parsed.value;
    }

    return searchReports(
      { reports: deps().reports },
      { orgId: actor.orgId },
      { query, folderId, ...cursor.value },
    );
  },
  toHttp: (result) => searchReportsToHttp(result, wireContext()),
});

export async function action(args: ActionFunctionArgs) {
  if (args.request.method !== "POST") {
    return toResponse(errorToHttp(methodNotAllowed("POST")));
  }
  return uploadHandler(args);
}

// The report is served on the PSL-isolated view origin (ADR-002 / ADR-0038):
// view_url = `${viewBaseUrl}/${slug}`. The composition root owns env access
// (ADR-0043) — canonical VIEW_ORIGIN on prod, request-origin fallback on previews.
// resolveUploadActor (the write-mode resolver) provisions the user's identity
// (User + personal Org + Root folder) on first sight.
const uploadHandler = handle({
  mode: "write",
  run: async ({ args, actor }) => {
    // Parse the multipart request into an UploadCommand, then run it against the
    // real adapters. The version is committed as `pending`; promotion happens
    // asynchronously when the scan drain processes it (ADR-0045) — the 201
    // truthfully returns scan_status: pending, and the viewer shows the holding
    // page until the drain promotes the clean version.
    const commandResult = await parseUploadCommand(args.request, actor);
    if (!commandResult.ok) return commandResult;
    return uploadReport(deps(), commandResult.value);
  },
  toHttp: (result, { args }) =>
    uploadResultToHttp(result, { viewBaseUrl: viewOrigin(args.request), mode: wireContext().mode }),
});

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
