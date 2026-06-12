// Phase-1 viewer (resource route) — serves a report's LIVE (clean-scanned)
// version by slug, read from R2, through the ADR-0038 §2 state machine.
//
// SECURITY NOTE (ADR-0038): the production viewer serves report content from a
// SEPARATE sandboxed origin (view.<domain>) with a strict CSP, never the app
// origin. This Phase-1 page serves it inline for the manually-testable demo;
// the sandboxed view-origin loader is the follow-up (1e). Keep that in mind
// before pointing real/untrusted uploads at it.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { resolveViewableReport } from "arp-application";
import { makeSlug } from "arp-domain";
import { viewHeaders } from "arp-headers/view";
import { deps } from "../server/container.server";

// 200 "scanning…" holding page (ADR-0038 §2): shown when a report exists but has
// no clean live version yet. Our own static HTML (no untrusted content), so the
// strict view CSP + a meta-refresh (no script) are fine. noindex.
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
  // Unknown/invalid slug is indistinguishable from blocked content → 404
  // (ADR-0038 §2: never acknowledge serious-bad content).
  if (!slug.ok) throw new Response("Not found", { status: 404 });

  // ADR-0038 §2 viewer gate (shared, unit-tested in arp-application).
  const outcome = await resolveViewableReport(slug.value, deps().reports);
  if (!outcome.ok) throw new Response("Lookup failed", { status: 500 });
  switch (outcome.value.kind) {
    case "deleted":
      throw new Response("No longer available", { status: 410 }); // taken down, no reason
    case "scanning":
      return scanningHoldingPage(); // 200, no clean live version yet
    case "flagged":
      throw new Response("Unavailable — flagged for review", { status: 451 });
    case "notfound":
      throw new Response("Not found", { status: 404 }); // unknown / blocked (reason-opaque)
  }

  // Clean live version → stream it from R2.
  const { report, liveVersion } = outcome.value;
  const blob = await deps().blobs.readObject(
    report.id,
    liveVersion.id,
    liveVersion.manifest.entryDocument,
  );
  if (!blob.ok) throw new Response("Read failed", { status: 500 });
  if (!blob.value) throw new Response("Not found", { status: 404 });

  // ADR-013: serve untrusted report HTML under the full viewer security stack
  // (enforcing + sandbox CSP, COOP/CORP, Origin-Agent-Cluster, Permissions-Policy,
  // HSTS). Reuses arp-headers/view (the same stack the view origin applies) so
  // inline scripts in uploaded HTML can't escape the sandbox even on this origin.
  const headers = viewHeaders();
  headers.set("content-type", blob.value.contentType);
  headers.set("cache-control", "no-store"); // never cache untrusted content
  headers.set("x-robots-tag", "noindex, nofollow");
  return new Response(blob.value.bytes as unknown as BodyInit, { headers });
}
