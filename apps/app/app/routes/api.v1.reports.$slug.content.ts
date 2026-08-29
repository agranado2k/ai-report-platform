// GET /api/v1/reports/{slug}/content[?version=<version_id>][&include=source] —
// read back a report VERSION's stored document as JSON (issue #312). The
// authenticated/MCP counterpart to the public viewer's byte serving: it lets a
// caller (an agent over the MCP, or the in-viewer editor) fetch a report's
// current HTML to UPDATE it in place, instead of blind-overwriting or
// rebuilding it. Default is the live version; `?version=` addresses a specific
// version by its `version_…` External Id (the wire id from GET .../versions or
// a save response); `include=source` also returns the ADR-0062 §4 `_source.json`
// ProseMirror doc when the version carries one.
//
// Auth via `resolveActorForRead` (handle mode:"read"): an org-visible read (or
// a cross-org write-grantee's carve-out), OR (last front door, ADR-0063) a
// slug-bound edit token — the SAME seam as api.v1.reports.$slug.diff.ts.
//
// CORS (ADR-0063): wrapped in `corsRoute` so the view-origin editor can read
// cross-origin — see api.v1.reports.$slug.versions.ts's header for the full
// rationale (Bearer-header auth, no credentials, OPTIONS answered before auth).
import { makeVersionId } from "arp-domain";
import { reportContentToHttp } from "arp-http";
import {
  deps,
  identityStore,
  orgWriteGrantStore,
  writeGrantStore,
} from "../server/container.server";
import { corsRoute } from "../server/cors.server";
import { handle } from "../server/handle.server";
import { wireContext } from "../server/http.server";
import { loadReportContent, parseIncludeSource } from "../server/report-content-loader.server";

export const loader = corsRoute(
  "GET, OPTIONS",
  handle({
    mode: "read",
    slug: true,
    run: ({ url, actor, slug }) => {
      const versionRaw = url.searchParams.get("version");

      const includeResult = parseIncludeSource(url.searchParams.get("include"));
      if (!includeResult.ok) return includeResult;

      const versionResult = versionRaw ? makeVersionId(versionRaw) : null;
      if (versionResult && !versionResult.ok) return versionResult;

      return loadReportContent(
        {
          reports: deps().reports,
          blobs: deps().blobs,
          grants: writeGrantStore(),
          orgWriteGrants: orgWriteGrantStore(),
          identities: identityStore(),
        },
        actor,
        slug,
        {
          ...(versionResult ? { versionId: versionResult.value } : {}),
          includeSource: includeResult.value,
        },
      );
    },
    toHttp: (result) => reportContentToHttp(result, wireContext()),
  }),
);
