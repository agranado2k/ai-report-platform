// POST /api/v1/reports — the production upload API (ADR-0037, ADR-0039, ADR-0040).
// Thin transport adapter: resolve the actor (auth seam) → parse the multipart
// body + Idempotency-Key → run the UploadReportUseCase → serialize via the pure
// arp-http mapper. All policy lives in the application/domain; this file only
// translates HTTP ⇆ use-case Result and never throws a bare error to the client.
import type { ActionFunctionArgs } from "@remix-run/node";
import { processScanResult, type UploadActor, uploadReport } from "arp-application";
import { err } from "arp-domain";
import { type HttpResponse, uploadResultToHttp } from "arp-http";
import { resolveUploadActor } from "../server/auth.server";
import { deps, ensureDevIdentity } from "../server/container.server";

export async function action({ request }: ActionFunctionArgs) {
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

  const viewBaseUrl = new URL(request.url).origin;
  const opts = { viewBaseUrl };

  // 1. Resolve the acting principal (Phase-1 dev identity; real auth later).
  const actorResult = await resolveUploadActor(request);
  if (!actorResult.ok) return toResponse(uploadResultToHttp(actorResult, opts));
  const actor = actorResult.value;

  // 2. Parse the multipart request into an UploadCommand.
  const commandResult = await parseUploadCommand(request, actor);
  if (!commandResult.ok) return toResponse(uploadResultToHttp(commandResult, opts));

  // 3. Run the use case against the real adapters.
  await ensureDevIdentity();
  const result = await uploadReport(deps(), commandResult.value);

  // 4. Phase-1 always-clean scan stub: promote the fresh version so /r/<slug>
  //    serves it. The 201 still reports `pending` per the contract — promotion is
  //    asynchronous from the client's view (it re-fetches the slug). Skipped on
  //    idempotent replay. Genuinely best-effort: this side effect must never turn
  //    the upload the client already earned into a 500 — a throw (e.g. a DB
  //    hiccup in findById, outside the use case's own tx-rollback catch) only
  //    leaves the version `pending`, which the viewer's holding page handles.
  if (result.ok && !result.value.replayed && result.value.reportId && result.value.versionId) {
    try {
      await processScanResult(deps(), {
        reportId: result.value.reportId,
        versionId: result.value.versionId,
        verdict: "clean",
      });
    } catch (e) {
      console.warn(`[api.v1.reports] scan-stub promotion failed (version stays pending):`, e);
    }
  }

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

/** Serialize the pure HttpResponse into a Remix/Fetch Response. */
function toResponse(http: HttpResponse): Response {
  return new Response(JSON.stringify(http.body), {
    status: http.status,
    headers: { "Content-Type": http.contentType, ...(http.headers ?? {}) },
  });
}
