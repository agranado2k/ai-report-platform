// GET /<slug>/edit — ADR-0063 Decision 3's dashboard-origin-editing fallback,
// shipped here as the INTERIM answer while the full in-viewer editing route
// (two CSP profiles on this origin, ADR-0063 Decisions 1-2) stays gated on
// its required `/security-review` pass. A pure, unauthenticated 302 redirect
// to the dashboard's own edit route (`app.<domain>/reports/<slug>/edit`,
// ADR-0062) — no JS, no HTML body, no session/token concept added to
// view.<domain>. Auth happens entirely on the dashboard AFTER the redirect
// (Clerk session + `loadWritableReport`'s canWrite gate, exactly as
// `reports.$slug.edit.tsx` already enforces) — this route makes no access
// decision of its own.
//
// Does NOT touch `$slug.tsx` (the public `GET /<slug>` route) — a disjoint
// Remix flat-route path (`/:slug/edit` vs `/:slug`; no catch-all route exists
// under apps/view, verified before adding this file), so the public viewer's
// behavior/headers are provably unaffected by this addition.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { makeSlug } from "arp-domain";
import { viewHeaders } from "arp-headers/view";
import { viewerAccessConfig } from "../server/container.server";
import { buildEditRedirectLocation } from "../server/edit-redirect";

export async function loader({ params }: LoaderFunctionArgs) {
  // Validate the slug's SHAPE before it ever reaches a Location header — not
  // an auth check (there is none here), just refusing to build a redirect
  // URL out of an arbitrary/malformed path segment.
  const slug = makeSlug(params.slug ?? "");
  if (!slug.ok) {
    const headers = viewHeaders();
    headers.set("content-type", "text/plain; charset=utf-8");
    headers.set("cache-control", "no-store");
    headers.set("x-robots-tag", "noindex, nofollow");
    return new Response("Not found", { status: 404, headers });
  }

  const { appOrigin } = viewerAccessConfig();
  const location = buildEditRedirectLocation(appOrigin, slug.value);
  if (!location) {
    // Fail closed when APP_ORIGIN is unset (previews/dev) — never guess at a
    // same-origin fallback; there is no editor on this origin to send anyone to.
    const headers = viewHeaders();
    headers.set("content-type", "text/plain; charset=utf-8");
    headers.set("cache-control", "no-store");
    headers.set("x-robots-tag", "noindex, nofollow");
    return new Response("Editing is not available here", { status: 503, headers });
  }

  const headers = viewHeaders();
  headers.set("location", location);
  headers.set("cache-control", "no-store");
  headers.set("x-robots-tag", "noindex, nofollow");
  return new Response(null, { status: 302, headers });
}
