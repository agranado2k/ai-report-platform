// Serialize a pure arp-http HttpResponse into a Remix/Fetch Response. Shared by
// every JSON API route (upload, list, …) so the transport translation lives in
// one place; all policy/shape decisions stay in the pure arp-http mappers.

import { json } from "@remix-run/node";
import { type AppError, encodeExternalId } from "arp-domain";
import { defineEnv } from "arp-env";
import { errorToHttp, type HttpResponse, type WireContext } from "arp-http";
import { activeTraceId } from "arp-observability";
import { log } from "./log.server";

/** A per-request `req_…` correlation id, returned in the Request-Id header. It IS the
 *  request's OTel trace_id, base62-encoded (ADR-0055, amends ADR-0053 §5) — so a
 *  Request-Id decodes straight to a Tempo trace. Falls back to a random id when no
 *  trace is active (telemetry off / untraced path). */
function requestId(): string {
  return encodeExternalId("req", activeTraceId() ?? crypto.randomUUID());
}

export function toResponse(http: HttpResponse): Response {
  const reqId = requestId();
  // Access log (ADR-0055): one structured line per API response, carrying the
  // trace-derived request_id; the OTel pino bridge ships it to Loki with the trace_id.
  log.info({ status: http.status, request_id: reqId }, "api response");
  const headers = { "Request-Id": reqId, ...(http.headers ?? {}) };
  // 204 No Content carries no body (and no Content-Type) — a JSON string there
  // would be an invalid response.
  if (http.status === 204) {
    return new Response(null, { status: 204, headers });
  }
  return new Response(JSON.stringify(http.body), {
    status: http.status,
    headers: { "Content-Type": http.contentType, ...headers },
  });
}

/** The wire context stamped onto every resource (ADR-0053): the deployment `mode`
 *  from the env (`live` key env → "prod", else "dev"). */
export function wireContext(): WireContext {
  return { mode: defineEnv().API_KEY_ENV === "live" ? "prod" : "dev" };
}

/**
 * The shared 401 for read routes when there's no identified actor (no session,
 * or a signed-in user with no org yet). Kept here so the message + shape live in
 * one place as more read routes land. Distinct from an infra failure, which the
 * routes render as a 500 problem via errorToHttp(err).
 */
export function unauthenticated(): HttpResponse {
  return errorToHttp({
    kind: "Unauthenticated",
    message: "a signed-in session with an active organization is required",
  });
}

/**
 * The dashboard (Remix `action`/`loader`) equivalent of `errorToHttp` — routes
 * dashboard errors through the SAME problemFor/errorToHttp status authority the
 * JSON API uses, instead of the ad hoc `kind === "ValidationError" ? 422 : 400`
 * ternaries that used to collapse NotFound/NotAllowed/PlanLimitExceeded/etc. to
 * a generic 400. Wraps the (already Unexpected-masked) detail message in the
 * `{ error: string }` shape the dashboard's `actionData` already renders — it
 * doesn't need the full RFC 9457 problem+json body, just the right status.
 */
export function errorToJson(error: AppError) {
  const http = errorToHttp(error);
  const detail = (http.body as { detail?: unknown }).detail;
  return json(
    { error: typeof detail === "string" ? detail : error.message },
    { status: http.status },
  );
}
