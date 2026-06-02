import { next } from "@vercel/edge";

export const config = {
  matcher: "/(.*)",
};

/**
 * Vercel Edge Middleware for the dashboard origin (`app.<domain>`).
 *
 * Phase 0c.2 stub. Real responsibilities land in Phase 1:
 *   - Signup / login / magic-link rate limit via Upstash.
 *   - Cloudflare Turnstile challenge on signup (threat #11 sybil).
 *   - CSRF token cookie issuance for dashboard mutations.
 *
 * The `x-edge-marker` header lets the Phase 0d infra test confirm the
 * edge actually ran.
 */
export default function middleware(_req: Request): Response {
  // TODO Phase 1: rate-limit signup / login / magic-link
  // TODO Phase 1: Turnstile challenge on signup paths
  // TODO Phase 1: CSRF double-submit cookie

  return next({
    headers: {
      "x-edge-marker": "app-mw",
    },
  });
}
