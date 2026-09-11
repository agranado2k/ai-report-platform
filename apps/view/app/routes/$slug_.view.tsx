// The OWNER VIEW (ADR-0089) — `GET view.<domain>/<slug>/view`.
//
// A thin strip of first-party chrome above the CANONICAL `/<slug>` itself, in
// a sandboxed iframe. What the owner sees is byte-for-byte what a share-link
// visitor sees, plus chrome. `GET /<slug>` is not touched by any of this: the
// byte-for-byte contract (ADR-0038) is the property this whole route exists to
// preserve, and it is why the chrome lives on a second URL rather than being
// injected into the report.
//
// FILENAME: the trailing `_` in `$slug_.view.tsx` is load-bearing and guarded
// by `../view/owner-view-route-nesting.test.ts`. As `$slug.view.tsx` this would
// dot-nest under `$slug.tsx`, so the PUBLIC viewer's loader would run first and
// unlock-wall a private report before this loader ever ran — the exact P0 that
// hit the editor (ADR-0063 Phase 5-F).
//
// Every serve rule lives in the ONE gate (`../server/gate.server.ts`,
// decision-matrix-tested) under `purpose: "ownerView"`. This loader only
// APPLIES the Decision.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { describeReportSharing } from "arp-domain";
import { editViewHeaders } from "arp-headers/view";
import { viewerAccessConfig, viewerDeps } from "../server/container.server";
import { decideServe, ownerViewDegradeLine } from "../server/gate.server";
import { viewerRedirectResponse, viewerTextResponse } from "../server/viewer-responses";
import { OwnerViewChrome } from "../view/components/OwnerViewChrome";

export async function loader({ params, request }: LoaderFunctionArgs) {
  const { secret, appOrigin } = viewerAccessConfig();
  const { reports, grants, orgWriteGrants } = viewerDeps();
  const slug = params.slug ?? "";

  const decision = await decideServe(request, slug, "ownerView", {
    reports,
    grants,
    secret,
    appOrigin,
    nowSeconds: Math.floor(Date.now() / 1000),
  });

  if (decision.kind === "error") throw viewerTextResponse(404, "Not found");
  if (decision.kind === "redirect") return viewerRedirectResponse(decision.to, 302);
  if (decision.kind === "setCookieAndRedirect") {
    return viewerRedirectResponse(decision.to, 303, decision.cookies);
  }
  if (!appOrigin) {
    // The gate never returns "serve" with `appOrigin` unset — it degrades
    // those itself. This is the same defensive narrowing `$slug_.edit.tsx`
    // carries, and for the same reason: `appOrigin` is the ROUTE's own local
    // (its header profile needs it), not something read back off the
    // Decision. Degrade exactly the way the gate would — through the gate's
    // own target, which carries the owner `?access=` fallback when one is in
    // play — and leave a line, rather than stranding an owner silently.
    console.warn(ownerViewDegradeLine(slug, decision.ownerFallback, "gate-decision-unusable"));
    return viewerRedirectResponse(decision.degradeTo, 302);
  }

  // ADR-0089 §5: the chrome page wears ADR-0063's AUTHENTICATED profile.
  // `viewHeaders()` would be wrong — its second, top-level `sandbox` CSP
  // exists to drop UNTRUSTED REPORT BYTES into an opaque origin, and this
  // document is our own first-party UI. What this profile gives us that the
  // public one does not: `frame-src 'self'` (permission to frame the report
  // from this side; `frame-ancestors 'self'` on the report's own response is
  // the other half, ADR-0088) and `frame-ancestors 'none'` (the chrome itself
  // is wholly unframeable). What it shares with the public profile, and what
  // the spike made non-negotiable: `Origin-Agent-Cluster: ?1`, so the chrome
  // and the report it frames are UNIFORMLY origin-keyed — Chromium warns when
  // they disagree.
  const headers = editViewHeaders({ appOrigin });
  headers.set("x-robots-tag", "noindex, nofollow");

  // The frame's own read capability (ADR-0089 §4c). APPEND, for the same
  // reason the redirect does — and note what this list may contain: only
  // `arp_unlock` at `Path=/<slug>`, never a capability cookie, because
  // `/<slug>` is the request the sandboxed iframe makes (§4a). The gate is
  // what enforces that; this loader only applies what it decided.
  for (const cookie of decision.cookies) headers.append("set-cookie", cookie);

  // The share state the chrome shows is the ADR-0078 `Report sharing description`
  // — the SAME copy the dashboard's badge renders, from the same domain
  // function, so the two surfaces cannot answer "how is this shared?"
  // differently. It needs the org write grant as well as the `Acl` mode,
  // because `org` alone cannot tell "the org can read it" from "the org can
  // edit it", and only one of those is worth an owner's alarm.
  //
  // A failed lookup degrades to `false` rather than throwing: that renders
  // `org` as "Org", which UNDERSTATES the grant but never invents one, and an
  // owner who came here to read their report should not be shown a 500
  // because a badge could not be computed.
  const orgWrite = await orgWriteGrants.find(decision.report.id);
  if (!orgWrite.ok) {
    console.warn(
      JSON.stringify({ event: "owner-view-org-write-lookup-failed", slug: decision.report.slug }),
    );
  }
  const sharing = describeReportSharing(
    decision.report.acl.mode,
    orgWrite.ok && orgWrite.value !== null,
  );

  // SECURITY (ADR-0089 §6): nothing capability-bearing goes into this payload.
  // The sharpest contrast with `/edit`, which deliberately hydrates its edit
  // token so client JS can Bearer it at the app-origin API — the owner view
  // calls nothing cross-origin, so it carries nothing, and its capability
  // stays in HttpOnly cookies this page's own JS cannot read. Adding a
  // client-side API call here would mean re-opening that argument.
  return json(
    {
      slug: decision.report.slug,
      docTitle: decision.report.title,
      shareState: sharing.label,
      canEdit: decision.capability === "write",
    },
    { headers },
  );
}

export default function OwnerView() {
  // Thin on purpose: everything the client does lives in `OwnerViewChrome`, so
  // the browser tier can mount it without a Remix router. This function exists
  // only to hand the loader's data across that seam.
  return <OwnerViewChrome {...useLoaderData<typeof loader>()} />;
}
