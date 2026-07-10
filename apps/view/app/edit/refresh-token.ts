// Client-side silent-refresh helper for the in-viewer editor's Bearer edit
// token (ADR-0063 Phase 5 — the view-origin half of the unified-experience
// cutover). The edit token is short-lived (`EDIT_TTL_SECONDS`, 15 min on the
// app origin) — an editing session that outlives it must not die mid-edit,
// so the route component schedules a call to this helper before expiry (see
// `../routes/$slug.edit.tsx`'s refresh `useEffect`, and `nextRefreshDelayMs`
// below for the scheduling math).
//
// POSTs the CURRENT token to the app-origin re-mint endpoint (`POST
// ${appOrigin}/api/v1/reports/{slug}/edit-token`, added by Phase 5-A) and
// returns either a fresh token + expiry or the SAME expired-session failure
// shape every other view→app client in this directory uses (`./http.ts`) —
// a 401/403 here means the token (or the underlying write grant) is no
// longer valid, and there is nothing the in-viewer client can do to recover
// (mirrors ./save-edit.ts's EXPIRED_MESSAGE posture exactly). Same
// cross-origin pattern as every other view→app call: Bearer-only,
// `credentials: "omit"` — the edit token IS the credential, no cookie ever
// rides along (see ./save-edit.ts's header comment for the full CORS/CSRF
// rationale, which applies identically here).
import {
  type ApiFailure,
  apiFailureFromResponse,
  NETWORK_ERROR_MESSAGE,
  networkFailure,
} from "./http";

export interface RefreshEditTokenInput {
  readonly appOrigin: string;
  readonly slug: string;
  readonly editToken: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

export type RefreshEditTokenResult =
  | { readonly ok: true; readonly editToken: string; readonly expiresAt: number }
  | ApiFailure;

interface EditTokenResponseBody {
  readonly object?: string;
  readonly edit_token?: string;
  readonly expires_at?: number;
}

/** POST the current edit token to the re-mint endpoint; returns a fresh
 *  token + expiry (epoch seconds) on success. */
export async function refreshEditToken(
  input: RefreshEditTokenInput,
): Promise<RefreshEditTokenResult> {
  const fetchImpl = input.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await fetchImpl(`${input.appOrigin}/api/v1/reports/${input.slug}/edit-token`, {
      method: "POST",
      credentials: "omit",
      headers: { authorization: `Bearer ${input.editToken}` },
    });
  } catch {
    return networkFailure(NETWORK_ERROR_MESSAGE);
  }

  if (!response.ok) return apiFailureFromResponse(response, "Failed to refresh edit session");

  const body = (await response.json()) as EditTokenResponseBody;
  if (!body.edit_token || typeof body.expires_at !== "number") {
    // Shouldn't happen against the real endpoint — defensive against a
    // malformed/unexpected 2xx body rather than trusting it blindly.
    return { ok: false, expired: false, message: "Refresh returned a malformed response." };
  }
  return { ok: true, editToken: body.edit_token, expiresAt: body.expires_at };
}

/**
 * Pure scheduling math for the silent-refresh timer — factored out of the
 * route component's `useEffect` so it's unit-testable without a DOM/jsdom
 * tier (this repo has none, per `vitest.config.ts`'s module doc). Returns
 * the delay (ms) until the NEXT refresh attempt, given the token's expiry
 * and the current time (both epoch seconds) and a skew margin (ms): refresh
 * `skewMs` before the token would actually expire, never after. Clamped to a
 * minimum of 0 — a token already inside (or past) the margin refreshes
 * immediately (a `setTimeout(fn, 0)`) rather than scheduling a negative/past
 * delay.
 */
export function nextRefreshDelayMs(
  expEpochSeconds: number,
  nowEpochSeconds: number,
  skewMs: number,
): number {
  const msUntilExpiry = (expEpochSeconds - nowEpochSeconds) * 1000;
  return Math.max(0, msUntilExpiry - skewMs);
}
