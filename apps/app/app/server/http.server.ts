// Serialize a pure arp-http HttpResponse into a Remix/Fetch Response. Shared by
// every JSON API route (upload, list, …) so the transport translation lives in
// one place; all policy/shape decisions stay in the pure arp-http mappers.

import { type AppError, err, ok, type Result } from "arp-domain";
import { errorToHttp, type HttpResponse } from "arp-http";

export function toResponse(http: HttpResponse): Response {
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

/**
 * Parse a JSON request body into an object, or a typed AppError the route can
 * render via errorToHttp: non-JSON content-type → 415, malformed/ non-object →
 * 422. Shared by the write API routes (move, create folder).
 */
export async function parseJsonBody(
  request: Request,
): Promise<Result<Record<string, unknown>, AppError>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return err({ kind: "UnsupportedMediaType", message: "expected application/json" });
  }
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return err({ kind: "ValidationError", message: "body must be a JSON object" });
    }
    return ok(body as Record<string, unknown>);
  } catch {
    return err({ kind: "ValidationError", message: "malformed JSON body" });
  }
}
