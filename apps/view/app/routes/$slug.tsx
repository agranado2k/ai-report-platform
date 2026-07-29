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
function scanningHoldingPage(): Response {
  const headers = viewHeaders();
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-robots-tag", "noindex, nofollow");
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta http-equiv="refresh" content="5" />
<title>Scanning…</title></head>
<body style="font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;text-align:center">
<h1>Scanning…</h1><p>This report is being checked. This page refreshes automatically.</p>
</body></html>`;
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
      headers.set("set-cookie", decision.cookie);
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
