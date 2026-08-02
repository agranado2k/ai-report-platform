// POST /api/v1/reports — the production upload API (ADR-0037, ADR-0039, ADR-0040).
// GET  /api/v1/reports — the acting org's reports, newest-created-first, cursor
// paginated + searchable (ADR-0036, ADR-0053).
// Thin transport adapter over the deepened `handle()` seam + the container's
// `ops()`: this file keeps ONLY its unique parsing (the multipart upload
// command, the search/cursor query params); actor resolution, method dispatch,
// the Idempotency-Key header (ADR-0039), and wiring live on the seam.
import type { UploadActor, uploadReport } from "arp-application";
import { err, type FolderId, makeFolderId, makeReportId } from "arp-domain";
import { parseCursorParams, searchReportsToHttp, uploadResultToHttp } from "arp-http";
import { ops, viewOrigin } from "../server/container.server";
import { handle, methods } from "../server/handle.server";
import { wireContext } from "../server/http.server";

export const loader = handle({
  mode: "read",
  run: ({ url, actor }) => {
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

    // Visibility-scoped listing (ADR-0075): the acting user decides which of
    // the org's reports appear (owned / org- or public-shared / write-granted).
    return ops().searchReports(
      { orgId: actor.orgId, userId: actor.userId },
      { query, folderId, ...cursor.value },
    );
  },
  toHttp: (result) => searchReportsToHttp(result, wireContext()),
});

// The report is served on the PSL-isolated view origin (ADR-002 / ADR-0038):
// view_url = `${viewBaseUrl}/${slug}`. The version is committed as `pending`;
// promotion happens asynchronously when the scan drain processes it (ADR-0045).
export const action = methods({
  POST: handle({
    mode: "write",
    run: async ({ args, actor, idempotencyKey }) => {
      const commandResult = await parseUploadCommand(args.request, actor, idempotencyKey);
      if (!commandResult.ok) return commandResult;
      return ops().uploadReport(commandResult.value);
    },
    toHttp: (result, { args }) =>
      uploadResultToHttp(result, {
        viewBaseUrl: viewOrigin(args.request),
        mode: wireContext().mode,
      }),
  }),
});

/** Map the multipart form into an UploadCommand, or a client error. */
async function parseUploadCommand(
  request: Request,
  actor: UploadActor,
  idempotencyKey: string | undefined,
) {
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

  const cmd: Parameters<typeof uploadReport>[1] = {
    actor,
    upload: { filename: file.name || "index.html", bytes },
    ...(updateSlug ? { updateSlug } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
  return { ok: true as const, value: cmd };
}

function strOrUndefined(v: FormDataEntryValue | string | null): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}
