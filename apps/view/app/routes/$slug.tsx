// The viewer — serves a report's LIVE (clean-scanned) version by slug at the
// canonical view.<domain>/<slug> path (ADR-002 origin isolation, ADR-0038). This
// is THE sandboxed view origin: untrusted report HTML is served here, never on
// the app origin, under the full ADR-013 security-header stack (viewHeaders).
// The ADR-0038 §2 gate is the shared, unit-tested resolveViewableReport.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { resolveViewableReport } from "arp-application";
import { makeSlug } from "arp-domain";
import { viewHeaders } from "arp-headers/view";
import { viewerDeps } from "../server/container.server";

// Thrown error responses (404 / 410 / 451 / 500) still carry the ADR-013 view
// header stack — notably HSTS — so even a first-ever request to view.<domain>
// that resolves to an error still sets the HSTS max-age in the browser. The
// bodies are all our own static strings (no untrusted content), so the strict
// CSP is fine. noindex.
function errorResponse(status: number, message: string): Response {
  const headers = viewHeaders();
  headers.set("content-type", "text/plain; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-robots-tag", "noindex, nofollow");
  return new Response(message, { status, headers });
}

// 200 "scanning…" holding page (ADR-0038 §2): a report exists but has no clean
// live version yet. Our own static HTML, so the strict view CSP + a meta-refresh
// (no script) are fine. noindex.
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

export async function loader({ params }: LoaderFunctionArgs) {
  const { reports, blobs } = viewerDeps();

  const slug = makeSlug(params.slug ?? "");
  // Unknown/invalid slug is indistinguishable from blocked content → 404.
  if (!slug.ok) throw errorResponse(404, "Not found");

  const outcome = await resolveViewableReport(slug.value, reports);
  if (!outcome.ok) throw errorResponse(500, "Lookup failed");
  switch (outcome.value.kind) {
    case "deleted":
      throw errorResponse(410, "No longer available");
    case "scanning":
      return scanningHoldingPage();
    case "flagged":
      throw errorResponse(451, "Unavailable — flagged for review");
    case "notfound":
      throw errorResponse(404, "Not found");
  }

  // Clean live version → stream it from R2 under the viewer security stack.
  const { report, liveVersion } = outcome.value;
  const blob = await blobs.readObject(
    report.id,
    liveVersion.id,
    liveVersion.manifest.entryDocument,
  );
  if (!blob.ok) throw errorResponse(500, "Read failed");
  if (!blob.value) throw errorResponse(404, "Not found");

  const headers = viewHeaders();
  headers.set("content-type", blob.value.contentType);
  headers.set("cache-control", "no-store"); // never cache untrusted content
  headers.set("x-robots-tag", "noindex, nofollow");
  return new Response(blob.value.bytes as unknown as BodyInit, { headers });
}
