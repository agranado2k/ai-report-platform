// The CORS route wrapper (ADR-0063 API slice) — glues arp-http's pure
// cors.ts header math to a real Remix loader/action for the handful of
// /api/v1 routes the cross-origin viewer-edit client calls (comments,
// versions, save, diff). Two responsibilities, both security-relevant:
//   1. Intercept `OPTIONS` BEFORE the wrapped handler ever runs — a
//      preflight carries no Authorization header (the browser strips it),
//      so routing it through the real handler would just 401 it; worse, it
//      must never touch auth/DB at all (fail-fast, no side effects on a
//      preflight).
//   2. Attach `Access-Control-Allow-Origin` (+ `Vary: Origin`, for cache
//      correctness — the response differs by request Origin) to the REAL
//      response, matching or not per corsResponseHeaders. This does NOT
//      gate the request itself — auth (resolveUploadActor/ForRead) still
//      decides whether the caller may act; CORS only decides whether
//      cross-origin browser JS is ALLOWED TO READ the response.
//
// The configured allow-list origin is read from `VIEW_ORIGIN` directly
// (arp-env's defineEnv), NOT container.server.ts's `viewOrigin(request)`
// helper — that helper falls back to the REQUEST's own origin when
// VIEW_ORIGIN is unset (previews/dev), which exists for building an
// absolute redirect URL. Reusing it here would make the allow-list
// trivially satisfiable by any caller (their own request origin always
// "matches" itself), defeating the point. CORS fails closed instead: no
// Origin is ever echoed when VIEW_ORIGIN isn't configured — the same
// fail-closed posture edit-token-actor.server.ts takes when its secret is
// unset.

import { defineEnv } from "arp-env";
import { corsPreflightResponse, corsResponseHeaders, mergeVary } from "arp-http";
import { toResponse } from "./http.server";

function configuredViewOrigin(): string | undefined {
  return defineEnv().VIEW_ORIGIN;
}

/**
 * Wrap a loader/action with CORS handling for the app-origin ↔ view-origin
 * edit-token API seam. `allowedMethods` is the resource's full
 * `Access-Control-Allow-Methods` value (e.g. "GET, POST, OPTIONS") —
 * advertised on the preflight regardless of which HTTP verb the wrapped
 * handler itself serves, since Remix/React-Router route ANY `OPTIONS`
 * request to the `loader` export (never `action`), so the loader's wrapper
 * is what a browser preflight actually reaches for either a GET or a POST
 * to the same resource path.
 */
export function corsRoute<Args extends { request: Request }>(
  allowedMethods: string,
  handler: (args: Args) => Promise<Response>,
): (args: Args) => Promise<Response> {
  return async (args: Args): Promise<Response> => {
    const origin = args.request.headers.get("Origin");
    const policy = { allowedOrigin: configuredViewOrigin(), allowedMethods };

    if (args.request.method === "OPTIONS") {
      const res = toResponse(corsPreflightResponse(origin, policy));
      // Merge, not set — a freshly-built preflight has no Vary today, but stay
      // uniform with the real-response branch below (claude-review #183 L-1).
      res.headers.set("Vary", mergeVary(res.headers.get("Vary"), "Origin"));
      return res;
    }

    const response = await handler(args);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsResponseHeaders(origin, policy))) {
      headers.set(key, value);
    }
    // Append `Origin` to any Vary the handler already set (e.g. Accept-Encoding)
    // rather than clobbering it → no cache poisoning (claude-review #183 L-1).
    headers.set("Vary", mergeVary(headers.get("Vary"), "Origin"));
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
