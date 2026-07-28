// GET  /api/v1/reports/{slug}/versions — the version-history read surface for one
// report (ADR-0065), cursor-paginated newest-created first. Thin transport
// adapter (ADR-0038) built from the `handle()` combinator: resolve the actor
// (read → no provision) + the slug → parse the cursor params → run the use case
// → serialize via arp-http. Auth is IDENTICAL to GET /api/v1/reports/{slug} —
// listReportVersions reuses the same loadOrgReport guard (ADR-0059 §3), so a
// report outside the actor's org reads as not-found/not-allowed exactly like
// the single-report GET.
//
// POST /api/v1/reports/{slug}/versions — save an edit as a NEW version
// (ADR-0062 §5, ADR-0063 API slice). Body: `{ doc: <ProseMirror doc JSON> }`.
// Auth via `resolveUploadActor` — a Clerk session, `arp_` API key, OR (the
// last front door, ADR-0063) a slug-bound edit token: `resolveEditTokenActor`
// already re-checks `canWrite` LIVE before this ever runs. Delegates the
// actual re-assembly (re-read the current version's shell, re-inject the
// edited body, run it through the ADR-0037 upload pipeline with
// `origin: 'editor'`) to `reassembleAndSaveEditedVersion` — the SAME helper
// reports.$slug.edit.tsx's dashboard action uses, so there is exactly one
// implementation of "what does saving an edit mean," not two that could
// drift. This is a SAVE, never a create: `reassembleAndSaveEditedVersion`
// always targets an existing report via `updateSlug` — there is no path from
// this route to `createReport`.
//
// CORS (ADR-0063): both verbs are wrapped in `corsRoute` — the view-origin
// editor calls this cross-origin, carrying its edit token as a Bearer header
// (never a cookie), so the response needs `Access-Control-Allow-Origin`
// echoed for the configured VIEW_ORIGIN, and an `OPTIONS` preflight answered
// before any auth runs.
import { listReportVersions } from "arp-application";
import { err, makeVersionId, ok, validationError } from "arp-domain";
import { listReportVersionsToHttp, parseCursorParams, uploadResultToHttp } from "arp-http";
import type { PMDocJson } from "arp-report-html";
import { resolveAuthorIdentities } from "../server/author-email.server";
import { deps, identityStore, viewOrigin } from "../server/container.server";
import { corsRoute } from "../server/cors.server";
import { handle } from "../server/handle.server";
import { wireContext } from "../server/http.server";
import { reassembleAndSaveEditedVersion } from "../server/save-edited-version.server";
import { uniqueVersionAuthorIds } from "../server/version-dto.server";

const ALLOWED_METHODS = "GET, POST, OPTIONS";

export const loader = corsRoute(
  ALLOWED_METHODS,
  handle({
    mode: "read",
    slug: true,
    run: async ({ args, actor, slug }) => {
      const url = new URL(args.request.url);
      const cursor = parseCursorParams(url.searchParams, makeVersionId);
      if (!cursor.ok) return cursor; // malformed cursor → 422

      const page = await listReportVersions(
        { reports: deps().reports },
        { orgId: actor.orgId },
        { slug, ...cursor.value },
      );
      if (!page.ok) return page;

      // ADR-0063 author display: resolve each unique uploader id → { name, email }
      // (ONE IdentityStore round-trip per distinct author), fold onto the wire below.
      const authorByUserId = await resolveAuthorIdentities(
        uniqueVersionAuthorIds(page.value.items),
        identityStore(),
      );
      return ok({ ...page.value, authorByUserId });
    },
    toHttp: (result) =>
      listReportVersionsToHttp(
        result,
        wireContext(),
        result.ok ? result.value.authorByUserId : undefined,
      ),
  }),
);

export const action = corsRoute(
  ALLOWED_METHODS,
  handle({
    mode: "write",
    slug: true,
    parseBody: true,
    run: ({ actor, slug, body }) => {
      const raw = body.doc;
      if (!raw || typeof raw !== "object") {
        return err(validationError("doc is required", "doc"));
      }
      return reassembleAndSaveEditedVersion(deps(), actor, slug, raw as PMDocJson);
    },
    toHttp: (result, { args }) =>
      uploadResultToHttp(result, {
        viewBaseUrl: viewOrigin(args.request),
        mode: wireContext().mode,
      }),
  }),
);
