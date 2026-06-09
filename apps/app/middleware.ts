import { next } from "@vercel/edge";

export const config = {
  matcher: "/(.*)",
};

/**
 * Vercel Edge Middleware for the dashboard origin (`app.<domain>`).
 *
 * ADR-014: block service-worker registration at the edge. The Phase-1 viewer
 * (`/r/<slug>`) currently serves uploaded HTML from THIS origin (until the
 * dedicated sandboxed view-origin lands, ADR-0038), so the same SW guard the
 * view origin applies must hold here — a registered SW could persist abusive
 * content past takedown. Mirrors `apps/view/middleware.ts`.
 *
 * Phase 0c.2 stub otherwise. Real responsibilities land in Phase 1:
 *   - Signup / login / magic-link rate limit via Upstash.
 *   - Cloudflare Turnstile challenge on signup (threat #11 sybil).
 *   - CSRF token cookie issuance for dashboard mutations.
 *
 * The `x-edge-marker` header lets the Phase 0d infra test confirm the
 * edge actually ran.
 */
export default function middleware(req: Request): Response {
  if (req.headers.get("service-worker") === "script") {
    return new Response("Service workers are not allowed on this origin.", {
      status: 403,
      headers: { "x-edge-marker": "app-mw-sw-blocked" },
    });
  }

  // TODO Phase 1: rate-limit signup / login / magic-link
  // TODO Phase 1: Turnstile challenge on signup paths
  // TODO Phase 1: CSRF double-submit cookie

  return next({
    headers: {
      "x-edge-marker": "app-mw",
    },
  });
}
