// The viewer origin's non-render responses: the 404 body and the redirect.
//
// Every route on this origin has to answer requests it will NOT render a
// document for — an invalid slug, a degrade to the public viewer, a capability
// hand-off that 303s to a clean URL — and every one of those answers is the
// same shape: the PUBLIC header profile, `no-store`, `noindex, nofollow`.
//
// The profile is the reason this is shared rather than three private helpers.
// `viewHeaders()` is the unauthenticated set; `editViewHeaders()` is the
// authenticated one, and what it adds is `frame-src 'self'` (permission to
// frame the report) and `frame-ancestors 'none'`, granted because the owner
// view's chrome is our own first-party UI. A response with no first-party UI
// in it — a bare 404, an empty redirect — has nothing to frame and must not
// carry that permission. Getting that backwards in one copy of three is a
// drift no route test would catch, because the route would still redirect to
// the right place; `viewer-responses.test.ts` is what pins it.
//
// SCOPE: `$slug_.edit.tsx` and `$slug_.view.tsx`, the origin's two
// AUTHENTICATED routes, are the callers. `$slug.tsx` — the canonical,
// byte-for-byte public viewer — keeps its own `errorResponse`, deliberately:
// ticket #361 AC 7 says that route's response is unchanged by the owner view,
// and "unchanged" is worth more on that one file than the last duplicate is
// worth removing. Folding it in belongs to whatever change next has reason to
// open it.
import { viewHeaders } from "arp-headers/view";

/** The shared spine: the public header profile, uncached and unindexed. */
function bareViewerHeaders(): Headers {
  const headers = viewHeaders();
  headers.set("cache-control", "no-store");
  headers.set("x-robots-tag", "noindex, nofollow");
  return headers;
}

/**
 * A plain-text response — the origin's 404 for a slug that never had a valid
 * shape, and the shape any other terminal text answer would take.
 *
 * Thrown rather than returned by the route loaders, so it still carries the
 * ADR-013 stack (notably HSTS): a first-ever request to `view.<domain>` that
 * resolves to an error still sets the max-age in the browser.
 */
export function viewerTextResponse(status: number, message: string): Response {
  const headers = bareViewerHeaders();
  headers.set("content-type", "text/plain; charset=utf-8");
  return new Response(message, { status, headers });
}

/**
 * A redirect, optionally carrying capability cookies.
 *
 * `302` is the degrade to the public viewer — an expired, invalid or absent
 * capability simply becomes a normal (possibly gated) view of the report,
 * exactly as ADR-0056's unlock flow degrades rather than erroring. `to` is
 * always the gate's own degrade location, which routes an OWNER through the
 * viewer's `?access=` flow when an `oa` fallback is in hand.
 *
 * `303` is the capability hand-off: the token is redeemed into a cookie and
 * the caller is sent to the clean URL, dropping it out of the address bar,
 * history and referer.
 *
 * `cookies` are APPENDED, never `set`. The owner view's hand-off carries up to
 * THREE capabilities in one response (ADR-0089 §4) and `set` would silently
 * collapse them to the last one — a failure that surfaces as a frame sitting
 * at the unlock wall, nowhere near the line that caused it.
 */
export function viewerRedirectResponse(
  to: string,
  status: 302 | 303,
  cookies: readonly string[] = [],
): Response {
  const headers = bareViewerHeaders();
  headers.set("location", to);
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(null, { status, headers });
}
