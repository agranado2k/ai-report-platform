// Shared fetch-all-pages cursor loop for the in-viewer editor's cross-origin
// list reads (unified-experience epic, ADR-0053 cursor envelope). Both
// comments-client.ts and versions-client.ts had a byte-for-byte-identical
// loop — same Bearer/`credentials: "omit"` fetch, same `starting_after` cursor
// walk, same `MAX_PAGES` safety cap, same error handling. Extracted here so the
// pagination behavior lives in ONE place (DRY); the two clients only differ in
// the resource path and the element type.
//
// PAGINATION (ADR-0053): follows the `{ data, has_more }` + `starting_after=<last
// id>` cursor envelope to load the COMPLETE set. `has_more` is returned (never
// discarded) so a set truncated at the page cap stays observable to the caller
// (the exact claude-review #184 bug this closed).
import {
  type ApiFailure,
  apiFailureFromResponse,
  NETWORK_ERROR_MESSAGE,
  networkFailure,
} from "./http";
import type { ListEnvelope } from "./wire-types";

/** Envelope page size. The API caps `limit` at 100 (ADR-0053). */
const PAGE_LIMIT = 100;
/** Safety bound on the fetch-all cursor loop: a report can never make the
 *  in-viewer client spin forever / exhaust memory. At `PAGE_LIMIT=100` this
 *  loads up to `MAX_PAGES * PAGE_LIMIT` items before giving up and reporting
 *  `has_more: true` (truncated). No realistic report approaches this; it exists
 *  to fail loud (an observable truncation) instead of hanging. */
const MAX_PAGES = 20;

export interface FetchAllPagesInput {
  readonly appOrigin: string;
  readonly slug: string;
  readonly editToken: string;
  /** The resource path segment under `/api/v1/reports/{slug}/` — e.g.
   *  `"comments"` or `"versions"`. */
  readonly resource: string;
  /** Fallback message for a non-ok (non-401/403) response. */
  readonly errorMessage: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

export type FetchAllPagesResult<T> =
  | {
      readonly ok: true;
      readonly items: readonly T[];
      /** `false` = the full set loaded; `true` = the loop hit `MAX_PAGES` with
       *  the cursor still open, so the returned set is TRUNCATED. */
      readonly has_more: boolean;
    }
  | ApiFailure;

/** Walk the ADR-0053 cursor envelope to accumulate every page of a report's
 *  `resource` list. `T` must carry a string `id` — it's the keyset cursor. */
export async function fetchAllPages<T extends { readonly id: string }>(
  input: FetchAllPagesInput,
): Promise<FetchAllPagesResult<T>> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const items: T[] = [];
  let startingAfter: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${input.appOrigin}/api/v1/reports/${input.slug}/${input.resource}`);
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
    // A mid-pagination failure aborts the whole load (never a silent partial):
    // callers already degrade an errored list to empty (buildEditLoaderExtras).
    if (!response.ok) return apiFailureFromResponse(response, input.errorMessage);

    const body = (await response.json()) as ListEnvelope<T>;
    items.push(...body.data);

    const last = body.data[body.data.length - 1];
    // Drained (or a defensive empty page that still claims `has_more`): done.
    if (!body.has_more || !last) return { ok: true, items, has_more: false };
    startingAfter = last.id;
  }

  // Hit the page cap with the cursor still open → the set is truncated.
  return { ok: true, items, has_more: true };
}
