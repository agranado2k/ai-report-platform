// Serialize a pure arp-http HttpResponse into a Remix/Fetch Response. Shared by
// every JSON API route (upload, list, …) so the transport translation lives in
// one place; all policy/shape decisions stay in the pure arp-http mappers.

import { errorToHttp, type HttpResponse } from "arp-http";

export function toResponse(http: HttpResponse): Response {
  // 204 No Content carries no body (and no Content-Type) — a JSON string there
  // would be an invalid response.
  if (http.status === 204) {
    return new Response(null, { status: 204, headers: { ...(http.headers ?? {}) } });
  }
  return new Response(JSON.stringify(http.body), {
    status: http.status,
    headers: { "Content-Type": http.contentType, ...(http.headers ?? {}) },
  });
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
