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
  const slug = makeSlug(params.slug ?? "");
  // Unknown/invalid slug is indistinguishable from blocked content → 404.
  if (!slug.ok) throw new Response("Not found", { status: 404 });

  const outcome = await resolveViewableReport(slug.value, viewerDeps().reports);
  if (!outcome.ok) throw new Response("Lookup failed", { status: 500 });
  switch (outcome.value.kind) {
    case "deleted":
      throw new Response("No longer available", { status: 410 });
    case "scanning":
      return scanningHoldingPage();
    case "flagged":
      throw new Response("Unavailable — flagged for review", { status: 451 });
    case "notfound":
      throw new Response("Not found", { status: 404 });
  }

  // Clean live version → stream it from R2 under the viewer security stack.
  const { report, liveVersion } = outcome.value;
  const blob = await viewerDeps().blobs.readObject(
    report.id,
    liveVersion.id,
    liveVersion.manifest.entryDocument,
  );
  if (!blob.ok) throw new Response("Read failed", { status: 500 });
  if (!blob.value) throw new Response("Not found", { status: 404 });

  const headers = viewHeaders();
  headers.set("content-type", blob.value.contentType);
  headers.set("cache-control", "no-store"); // never cache untrusted content
  headers.set("x-robots-tag", "noindex, nofollow");
  return new Response(blob.value.bytes as unknown as BodyInit, { headers });
}
