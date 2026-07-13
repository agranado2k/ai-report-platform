// Cross-origin version-history read for the in-viewer editor's Versions tab
// (unified-experience epic, ADR-0065 / ADR-0063's edit-token API acceptance
// seam). Same Bearer-only, `credentials: "omit"` pattern as ../edit/save-edit.ts.
// Called from the `/<slug>/edit` route's LOADER (server-to-server, no CORS
// involved) — there is no client-side version-history mutation, so this is
// the only entry point (Compare itself is a separate read, diff-client.ts).
import { fetchAllPages } from "./fetch-all-pages";
import type { ApiFailure } from "./http";
import type { VersionWire } from "./wire-types";

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

// PAGINATION (ADR-0053): the shared `fetchAllPages` helper walks the cursor
// envelope to load the COMPLETE version history — the same loop
// comments-client.ts uses (DRY). `has_more` stays observable (true only when
// truncated at the page cap).
export async function listVersions(input: ListVersionsInput): Promise<ListVersionsResult> {
  const result = await fetchAllPages<VersionWire>({
    appOrigin: input.appOrigin,
    slug: input.slug,
    editToken: input.editToken,
    resource: "versions",
    errorMessage: "Failed to load versions",
    fetchImpl: input.fetchImpl,
  });
  if (!result.ok) return result;
  return { ok: true, versions: result.items, has_more: result.has_more };
}
