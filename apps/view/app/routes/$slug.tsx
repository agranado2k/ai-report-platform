// The viewer — serves a report's LIVE (clean-scanned) version by slug at the
// canonical view.<domain>/<slug> path (ADR-002 origin isolation, ADR-0038). This
// is THE sandboxed view origin: untrusted report HTML is served here, never on
// the app origin, under the full ADR-013 security-header stack (viewHeaders).
//
// Every serve decision — the ADR-0038 §2 state machine, the ?v=N ordinal
// (ADR-0038 §3), and the ADR-0056 ACL gate with its arp_unlock cookie /
// ?access= hand-off — lives in the ONE viewer gate, decideServe
// (../server/gate.server.ts, decision-matrix-tested). This loader only
// APPLIES the Decision: build the response headers for each kind and stream
// the blob on "serve".
import type { LoaderFunctionArgs } from "@remix-run/node";
import { viewHeaders } from "arp-headers/view";
import { viewerAccessConfig, viewerDeps } from "../server/container.server";
import { decideServe } from "../server/gate.server";

// Thrown error responses (404 / 410 / 451 / 500 / 503) still carry the ADR-013
// view header stack — notably HSTS — so even a first-ever request to
// view.<domain> that resolves to an error still sets the HSTS max-age in the
// browser. The bodies are all our own static strings (no untrusted content),
// so the strict CSP is fine. noindex.
function errorResponse(status: number, message: string): Response {
  const headers = viewHeaders();
  headers.set("content-type", "text/plain; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-robots-tag", "noindex, nofollow");
  return new Response(message, { status, headers });
}

// 200 "scanning…" holding page (ADR-0038 §2): a report exists but has no clean
// live version yet. Our own static HTML, so the strict view CSP + a meta-refresh
// (no script) are fine. noindex. The gate only emits `interstitial` AFTER the
// ACL gate has granted access (M7 / PR #170 ordering — see gate.server.ts).
//
// Styled to the product's light identity (App Shell Mockups Z0W60dI8hu, SECTION
// 05; ADR-0086): the palette is inlined because a raw Response has no build step
// to @import packages/ui/src/theme.css, and the values mirror that file
// (light-only — `color-scheme: light`, never `prefers-color-scheme`). The
// spinner is a pure CSS animation (no script) and honours reduced-motion.
// `style-src 'self' 'unsafe-inline'` on the enforcing VIEW_CSP allows the inline
// <style>; the report-only shadow already flags inline styling here (the page's
// prior inline `style=` attribute did too), so this adds no NEW enforced risk.
const SCANNING_STYLE = `<style>
:root {
  color-scheme: light;
  --bg: #f5f6f8;
  --fg: #2a2e34;
  --muted: #656f7d;
  --subtle: #6b7684;
  --brand: #7b68ee;
  --brand-soft: #f2f1fd;
}
* { box-sizing: border-box }
body {
  margin: 0; min-height: 100vh; padding: 2rem 1.5rem;
  display: flex; flex-direction: column; justify-content: center; align-items: center;
  background: var(--bg); color: var(--fg); text-align: center;
  font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
}
main { width: 100%; max-width: 34rem }
.eyebrow {
  font-size: .6875rem; letter-spacing: .12em; text-transform: uppercase;
  color: var(--subtle); margin: 0 0 1.75rem;
}
.spinner {
  width: 28px; height: 28px; margin: 0 auto 1.5rem; border-radius: 50%;
  border: 3px solid var(--brand-soft); border-top-color: var(--brand);
  animation: spin .8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg) } }
@media (prefers-reduced-motion: reduce) { .spinner { animation: none } }
h1 { font-size: 1.5rem; line-height: 1.25; font-weight: 600; margin: 0 0 .75rem }
p { margin: 0; color: var(--muted) }
</style>`;

function scanningHoldingPage(): Response {
  const headers = viewHeaders();
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-robots-tag", "noindex, nofollow");
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta http-equiv="refresh" content="5" />
<title>Scanning…</title>${SCANNING_STYLE}</head>
<body><main><p class="eyebrow">Centaur Spec</p>
<div class="spinner" aria-hidden="true"></div>
<h1>Scanning…</h1><p>This report is being checked for safety. This page refreshes automatically.</p>
</main></body></html>`;
  return new Response(body, { status: 200, headers });
}

export async function loader({ params, request }: LoaderFunctionArgs) {
  const { reports, blobs, grants } = viewerDeps();
  const { secret, appOrigin } = viewerAccessConfig();

  const decision = await decideServe(request, params.slug ?? "", "view", {
    reports,
    grants,
    secret,
    appOrigin,
    nowSeconds: Math.floor(Date.now() / 1000),
  });

  switch (decision.kind) {
    case "error":
      throw errorResponse(decision.status, decision.message);
    case "redirect": {
      // Send the viewer to the app to authorize (the unlock hand-off).
      const headers = viewHeaders();
      headers.set("location", decision.to);
      headers.set("cache-control", "no-store");
      return new Response(null, { status: 302, headers });
    }
    case "setCookieAndRedirect": {
      // Valid ?access= hand-off → set the unlock cookie (lasting as long as the
      // token/grant) and redirect to the clean URL (drops the token from the
      // address bar / history).
      const headers = viewHeaders();
      headers.set("location", decision.to);
      // APPEND, never set — the gate may hand back more than one capability
      // cookie for a single hand-off (see Decision.cookies).
      for (const cookie of decision.cookies) headers.append("set-cookie", cookie);
      headers.set("cache-control", "no-store");
      return new Response(null, { status: 303, headers });
    }
    case "interstitial":
      return scanningHoldingPage();
    case "serve": {
      const { report, version } = decision;
      const blob = await blobs.readObject(report.id, version.id, version.manifest.entryDocument);
      if (!blob.ok) throw errorResponse(500, "Read failed");
      if (!blob.value) throw errorResponse(404, "Not found");

      const headers = viewHeaders();
      headers.set("content-type", blob.value.contentType);
      headers.set("cache-control", "no-store"); // never cache untrusted content
      headers.set("x-robots-tag", "noindex, nofollow");
      return new Response(blob.value.bytes as unknown as BodyInit, { headers });
    }
  }
}
