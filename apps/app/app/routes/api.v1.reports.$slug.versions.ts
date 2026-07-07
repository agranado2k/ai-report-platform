// GET /api/v1/reports/{slug}/versions — the version-history read surface for one
// report (ADR-0065), cursor-paginated newest-created first. Thin transport
// adapter (ADR-0038) built from the `handle()` combinator: resolve the actor
// (read → no provision) + the slug → parse the cursor params → run the use case
// → serialize via arp-http. Auth is IDENTICAL to GET /api/v1/reports/{slug} —
// listReportVersions reuses the same loadOrgReport guard (ADR-0059 §3), so a
// report outside the actor's org reads as not-found/not-allowed exactly like
// the single-report GET.
import { listReportVersions } from "arp-application";
import { makeVersionId } from "arp-domain";
import { listReportVersionsToHttp, parseCursorParams } from "arp-http";
import { deps } from "../server/container.server";
import { handle } from "../server/handle.server";
import { wireContext } from "../server/http.server";

export const loader = handle({
  mode: "read",
  slug: true,
  run: ({ args, actor, slug }) => {
    const url = new URL(args.request.url);
    const cursor = parseCursorParams(url.searchParams, makeVersionId);
    if (!cursor.ok) return cursor; // malformed cursor → 422

    return listReportVersions(
      { reports: deps().reports },
      { orgId: actor.orgId },
      { slug, ...cursor.value },
    );
  },
  toHttp: (result) => listReportVersionsToHttp(result, wireContext()),
});
