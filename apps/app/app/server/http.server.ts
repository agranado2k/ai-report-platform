// Serialize a pure arp-http HttpResponse into a Remix/Fetch Response. Shared by
// every JSON API route (upload, list, …) so the transport translation lives in
// one place; all policy/shape decisions stay in the pure arp-http mappers.

import { type AppError, encodeExternalId, err, ok, type Result, validationError } from "arp-domain";
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

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Parse the cursor-pagination params (ADR-0053): `limit` (clamped 1..100, default
 * 20) + `starting_after`/`ending_before` decoded via the entity's `make*Id` (a
 * malformed cursor → 422). The single place the pagination rule lives.
 */
export function parseCursorParams<Id>(
  sp: URLSearchParams,
  decode: (s: string) => Result<Id, AppError>,
): Result<{ limit: number; startingAfter?: Id; endingBefore?: Id }, AppError> {
  const raw = Number.parseInt(sp.get("limit") ?? "", 10);
  const limit = Number.isFinite(raw) ? Math.min(MAX_LIMIT, Math.max(1, raw)) : DEFAULT_LIMIT;

  const out: { limit: number; startingAfter?: Id; endingBefore?: Id } = { limit };
  const after = sp.get("starting_after")?.trim();
  const before = sp.get("ending_before")?.trim();
  if (after && before) {
    return err(validationError("pass only one of starting_after / ending_before", "cursor"));
  }
  if (after) {
    const d = decode(after);
    if (!d.ok) return d;
    out.startingAfter = d.value;
  }
  if (before) {
    const d = decode(before);
    if (!d.ok) return d;
    out.endingBefore = d.value;
  }
  return ok(out);
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
