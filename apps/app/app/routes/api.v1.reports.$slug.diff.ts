// GET /api/v1/reports/{slug}/diff?from=<version_id>&to=<version_id> — the
// visual diff between two of a report's versions, as JSON (ADR-0063 API
// slice, ADR-0065 §3/§4) — the cross-origin counterpart to the dashboard's
// HTML `reports.$slug.diff.tsx` page. Auth via `resolveActorForRead`: an
// org-visible read (or a cross-org write-grantee's carve-out), OR (last
// front door, ADR-0063) a slug-bound edit token — `resolveEditTokenActor`'s
// candidate `orgId` is read off the SAME live report row, so its own
// org-match guard here is satisfied trivially once the token itself has
// already been accepted.
//
// Addresses versions by their `version_…` External Id (NOT the dashboard
// page's display ordinal `?from=N&to=N`) — the wire id a cross-origin caller
// already holds from GET .../versions or a save response, and the only
// address it can use without a DB lookup to translate an ordinal.
//
// CORS (ADR-0063): wrapped in `corsRoute` — see api.v1.reports.$slug.versions.ts's
// header comment for the full rationale (Bearer-header auth, no credentials,
// OPTIONS answered before auth).
import { err, makeVersionId, validationError } from "arp-domain";
import { reportDiffToHttp } from "arp-http";
import { deps, identityStore, writeGrantStore } from "../server/container.server";
import { corsRoute } from "../server/cors.server";
import { handle } from "../server/handle.server";
import { wireContext } from "../server/http.server";
import { loadReportDiff } from "../server/report-diff-loader.server";

export const loader = corsRoute(
  "GET, OPTIONS",
  handle({
    mode: "read",
    slug: true,
    run: ({ args, actor, slug }) => {
      const url = new URL(args.request.url);
      const fromRaw = url.searchParams.get("from");
      const toRaw = url.searchParams.get("to");
      if (!fromRaw || !toRaw) {
        return err(validationError("'from' and 'to' query params are required", "from"));
      }

      const fromId = makeVersionId(fromRaw);
      if (!fromId.ok) return fromId;
      const toId = makeVersionId(toRaw);
      if (!toId.ok) return toId;

      return loadReportDiff(
        {
          reports: deps().reports,
          blobs: deps().blobs,
          grants: writeGrantStore(),
          identities: identityStore(),
        },
        actor,
        slug,
        { fromVersionId: fromId.value, toVersionId: toId.value },
      );
    },
    toHttp: (result) => reportDiffToHttp(result, wireContext()),
  }),
);
