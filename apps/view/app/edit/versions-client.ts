// Cross-origin version-history read for the in-viewer editor's Versions tab
// (unified-experience epic, ADR-0065 / ADR-0063's edit-token API acceptance
// seam). Same Bearer-only, `credentials: "omit"` pattern as ../edit/save-edit.ts.
// Called from the `/<slug>/edit` route's LOADER (server-to-server, no CORS
// involved) — there is no client-side version-history mutation, so this is
// the only entry point (Compare itself is a separate read, diff-client.ts).
import {
  type ApiFailure,
  apiFailureFromResponse,
  NETWORK_ERROR_MESSAGE,
  networkFailure,
} from "./http";
import type { ListEnvelope, VersionWire } from "./wire-types";

export interface ListVersionsInput {
  readonly appOrigin: string;
  readonly slug: string;
  readonly editToken: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

export type ListVersionsResult =
  | {
      readonly ok: true;
      readonly versions: readonly VersionWire[];
      /** Cursor exhausted? `false` means the full history is loaded. Can only be
       *  `true` if the fetch-all loop hit its `MAX_PAGES` cap while the server
       *  still had more (truncated). See the loop below — mirrors
       *  `ListCommentsResult.has_more`. */
      readonly has_more: boolean;
    }
  | ApiFailure;

/** Envelope page size. The API caps `limit` at 100 (ADR-0053). */
const PAGE_LIMIT = 100;
/** Safety bound on the fetch-all cursor loop (see comments-client.ts's
 *  `MAX_PAGES` for the full rationale): up to `MAX_PAGES * PAGE_LIMIT`
 *  versions before giving up with `has_more: true`. */
const MAX_PAGES = 20;

// PAGINATION (this change; supersedes the #184 "v1 cap"): follow the ADR-0053
// cursor envelope (`{ data, has_more }` + `starting_after=<last id>`) to load
// the COMPLETE version history, so a report with >100 versions no longer
// silently truncates. Same approach-A choice (fetch-all, no "Load more"
// button) as comments-client.ts — see its header for the why.
export async function listVersions(input: ListVersionsInput): Promise<ListVersionsResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const versions: VersionWire[] = [];
  let startingAfter: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${input.appOrigin}/api/v1/reports/${input.slug}/versions`);
    url.searchParams.set("limit", String(PAGE_LIMIT));
    if (startingAfter) url.searchParams.set("starting_after", startingAfter);

    let response: Response;
    try {
      response = await fetchImpl(url.toString(), {
        method: "GET",
        credentials: "omit",
        headers: { authorization: `Bearer ${input.editToken}` },
      });
    } catch {
      return networkFailure(NETWORK_ERROR_MESSAGE);
    }
    if (!response.ok) return apiFailureFromResponse(response, "Failed to load versions");

    const body = (await response.json()) as ListEnvelope<VersionWire>;
    versions.push(...body.data);

    const last = body.data[body.data.length - 1];
    if (!body.has_more || !last) return { ok: true, versions, has_more: false };
    startingAfter = last.id;
  }

  return { ok: true, versions, has_more: true };
}
