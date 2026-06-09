// Phase-1 viewer (resource route) — serves a report's entry document by slug,
// read from R2. Resolves slug → Report → latest version → R2 entry doc.
//
// SECURITY NOTE (ADR-0038): the production viewer serves report content from a
// SEPARATE sandboxed origin (view.<domain>) with a strict CSP, never the app
// origin. This Phase-1 page serves it inline for the manually-testable demo;
// the sandboxed view-origin loader is the follow-up (1e). Keep that in mind
// before pointing real/untrusted uploads at it.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { makeSlug } from "arp-domain";
import { viewHeaders } from "arp-headers/view";
import { deps } from "../server/container.server";

export async function loader({ params }: LoaderFunctionArgs) {
  const slug = makeSlug(params.slug ?? "");
  if (!slug.ok) throw new Response("Invalid report id", { status: 400 });

  const found = await deps().reports.findBySlug(slug.value);
  if (!found.ok) throw new Response("Lookup failed", { status: 500 });
  if (!found.value) throw new Response("Report not found", { status: 404 });

  const report = found.value;
  const version = report.versions[report.versions.length - 1];
  if (!version) throw new Response("Report has no version", { status: 404 });

  const blob = await deps().blobs.readObject(report.id, version.id, version.manifest.entryDocument);
  if (!blob.ok) throw new Response("Read failed", { status: 500 });
  if (!blob.value) throw new Response("Report content missing", { status: 404 });

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
