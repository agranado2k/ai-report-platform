// Cross-origin visual-diff read for the in-viewer editor's Compare feature
// (unified-experience epic, ADR-0065 §3/§4 / ADR-0063's edit-token API
// acceptance seam). Same Bearer-only, `credentials: "omit"` pattern as
// ../edit/save-edit.ts. Client-only (triggered by the user picking two
// versions in the Versions tab and clicking Compare) — there is no
// server-side diff prefetch in the loader.
//
// SECURITY (F-1, claude-review #183): `DiffWire.html` is a body FRAGMENT
// derived from stored report content — untrusted. This module only fetches
// and returns it; the CALLER is responsible for reinjecting it into the
// report's shell and rendering it through `buildReadOnlyIframeDocument`'s
// sandboxed `srcDoc` (see ../edit/components/SandboxedHtml.tsx) — never via
// `dangerouslySetInnerHTML`, never on the app origin. This module does not
// touch the DOM at all, so it cannot itself violate that boundary.
import {
  type ApiFailure,
  apiFailureFromResponse,
  NETWORK_ERROR_MESSAGE,
  networkFailure,
} from "./http";
import type { DiffWire } from "./wire-types";

export interface GetDiffInput {
  readonly appOrigin: string;
  readonly slug: string;
  readonly editToken: string;
  readonly fromVersionId: string;
  readonly toVersionId: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

export type GetDiffResult = { readonly ok: true; readonly diff: DiffWire } | ApiFailure;

export async function getDiff(input: GetDiffInput): Promise<GetDiffResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = new URL(`${input.appOrigin}/api/v1/reports/${input.slug}/diff`);
  url.searchParams.set("from", input.fromVersionId);
  url.searchParams.set("to", input.toVersionId);

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
  if (!response.ok) return apiFailureFromResponse(response, "Failed to load diff");
  const diff = (await response.json()) as DiffWire;
  return { ok: true, diff };
}
