import { next } from "@vercel/edge";

export const config = {
  matcher: "/(.*)",
};

/**
 * Vercel Edge Middleware for the viewer origin (`view.<domain>`).
 *
 * ADR-014: block service worker registration at the edge. Browsers send
 * `Service-Worker: script` on the script fetch they intend to register;
 * we return 403 so the registration never completes and abusive content
 * cannot persist past takedown via cached SW responses.
 *
 * Phase 0c.2 stubs only — real rate-limit (Upstash) and `scan_status`
 * precheck land in Phase 1. The `x-edge-marker` header lets the Phase 0d
 * `edge-middleware.feature` infra test confirm the edge actually ran.
 */
export default function middleware(req: Request): Response {
  const swHeader = req.headers.get("service-worker");
  if (swHeader === "script") {
    return new Response("Service workers are not allowed on this origin.", {
      status: 403,
      headers: { "x-edge-marker": "view-mw-sw-blocked" },
    });
  }

  // TODO Phase 1: per-IP rate limit via Upstash sliding-window
  // TODO Phase 1: scan_status precheck → 451 interstitial for flagged versions

  return next({
    headers: {
      "x-edge-marker": "view-mw",
    },
  });
}
