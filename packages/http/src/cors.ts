// The CORS seam for the view.<domain> -> app.<domain> edit-token API surface
// (ADR-0063 API slice). Pure header math only — no request/Response types,
// so it's testable without a Fetch polyfill; the server-side wiring (reading
// the configured VIEW_ORIGIN, wrapping loaders/actions, attaching Vary) lives
// in apps/app/app/server/cors.server.ts.
//
// SECURITY POSTURE (binding, do not relax):
//   - Access-Control-Allow-Origin is the EXACT configured origin, echoed back
//     ONLY when the request's Origin matches it byte-for-byte — NEVER `*`,
//     NEVER a reflected arbitrary Origin. An unconfigured origin (undefined —
//     previews/dev, same posture as the edit-token secret being unset) means
//     NO origin is ever allowed: fail closed, not "allow same-origin only" or
//     any other guess.
//   - Access-Control-Allow-Credentials is NEVER set. Auth on these endpoints
//     rides an `Authorization: Bearer <editToken>` header, not a cookie — the
//     browser never attaches the app-origin Clerk session cookie to a
//     cross-origin fetch/XHR regardless (Credentials must be explicitly
//     'include' AND allow-credentials must be set for that to happen), and
//     deliberately never opting into it here closes that avenue entirely.
import type { HttpResponse } from "./problem";

export interface CorsPolicy {
  /** The single allowed cross-origin caller (the app's own VIEW_ORIGIN
   *  config) — `undefined` when unset (previews/dev), which fails closed:
   *  no Origin is ever echoed. */
  readonly allowedOrigin: string | undefined;
}

export interface CorsPreflightPolicy extends CorsPolicy {
  /** The literal `Access-Control-Allow-Methods` value for this resource,
   *  e.g. "GET, POST, OPTIONS". */
  readonly allowedMethods: string;
}

/** The CORS response headers for an ACTUAL (non-preflight) response — just
 *  `Access-Control-Allow-Origin`, and only when the request's `Origin`
 *  matches the configured allow-list origin exactly. Returns `{}` (no
 *  headers) on any mismatch, a missing Origin, or an unconfigured policy —
 *  the caller (cors.server.ts) still serves the response either way; this
 *  only decides whether cross-origin browser JS is allowed to READ it. */
export function corsResponseHeaders(
  requestOrigin: string | null,
  policy: CorsPolicy,
): Record<string, string> {
  if (!policy.allowedOrigin || requestOrigin !== policy.allowedOrigin) return {};
  return { "Access-Control-Allow-Origin": policy.allowedOrigin };
}

/** The full `OPTIONS` preflight response: 204, no body, `Access-Control-
 *  Allow-Headers: Authorization, Content-Type` (the only two headers these
 *  endpoints ever need) + the resource's `Access-Control-Allow-Methods`,
 *  PLUS `Access-Control-Allow-Origin` when (and only when) the Origin
 *  matches — see `corsResponseHeaders`. Always answers 204 regardless of
 *  Origin match (a non-matching preflight is harmless: without
 *  Allow-Origin the browser blocks the real request anyway), so this never
 *  becomes an origin-probing oracle. */
export function corsPreflightResponse(
  requestOrigin: string | null,
  policy: CorsPreflightPolicy,
): HttpResponse {
  return {
    status: 204,
    contentType: "application/json",
    body: undefined,
    headers: {
      ...corsResponseHeaders(requestOrigin, policy),
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": policy.allowedMethods,
    },
  };
}
