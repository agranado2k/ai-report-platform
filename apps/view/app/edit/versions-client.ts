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
  | { readonly ok: true; readonly versions: readonly VersionWire[] }
  | ApiFailure;

export async function listVersions(input: ListVersionsInput): Promise<ListVersionsResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(
      `${input.appOrigin}/api/v1/reports/${input.slug}/versions?limit=100`,
      {
        method: "GET",
        credentials: "omit",
        headers: { authorization: `Bearer ${input.editToken}` },
      },
    );
  } catch {
    return networkFailure(NETWORK_ERROR_MESSAGE);
  }
  if (!response.ok) return apiFailureFromResponse(response, "Failed to load versions");
  const body = (await response.json()) as ListEnvelope<VersionWire>;
  return { ok: true, versions: body.data };
}
