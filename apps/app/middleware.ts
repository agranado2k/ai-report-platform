import { next } from "@vercel/edge";

export const config = {
  matcher: "/(.*)",
};

/**
 * Vercel Edge Middleware for the dashboard origin (`app.<domain>`).
 *
 * ADR-014: block service-worker registration at the edge. Untrusted report HTML
 * is now served only on the sandboxed view origin (ADR-002 / ADR-0038) — the app
 * origin no longer serves it. We keep the SW guard here as defense-in-depth: the
 * dashboard origin should never allow a service worker to be registered against
 * it. Mirrors `apps/view/middleware.ts`.
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
