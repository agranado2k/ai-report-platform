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

  return new Response(blob.value.bytes as unknown as BodyInit, {
    headers: {
      "content-type": blob.value.contentType,
      "cache-control": "no-store",
    },
  });
}
