// Shared error-mapping for the unified-experience epic's cross-origin
// comment/version/diff fetch helpers (comments-client.ts, versions-client.ts,
// diff-client.ts) — factored out of ../edit/save-edit.ts's inline pattern
// since five call sites (list/add/reply/resolve comments, list versions, get
// diff) would otherwise each hand-roll the identical 401/403 → "session
// expired" mapping. `save-edit.ts` itself is untouched (ADR-0063 Phase 4,
// out of scope for this epic) — this is a NEW, narrower helper the newer
// call sites share.
const EXPIRED_MESSAGE = "Your editing session has expired — reopen this report from the dashboard.";

export interface ApiFailure {
  readonly ok: false;
  /** True for 401/403 — the edit token is no longer valid (expired, or the
   *  underlying write grant was revoked server-side). Callers surface the
   *  SAME "reopen from the dashboard" message saveEdit does for these — there
   *  is nothing the in-viewer client can do to recover either case. */
  readonly expired: boolean;
  readonly message: string;
}

/** Map a non-ok `Response` to an `ApiFailure`. Prefers the RFC-9457
 *  `application/problem+json` body's `detail` (author-controlled, safe to
 *  surface — see `packages/http/src/problem.ts`) when present and parseable;
 *  falls back to `<fallback> (<status>).` otherwise. */
export async function apiFailureFromResponse(
  response: Response,
  fallback: string,
): Promise<ApiFailure> {
  if (response.status === 401 || response.status === 403) {
    return { ok: false, expired: true, message: EXPIRED_MESSAGE };
  }
  let detail: string | undefined;
  try {
    const body = (await response.json()) as { detail?: unknown };
    detail = typeof body.detail === "string" ? body.detail : undefined;
  } catch {
    // Non-JSON (or empty) error body — fall through to the generic message.
  }
  return { ok: false, expired: false, message: detail ?? `${fallback} (${response.status}).` };
}

/** A network-level failure (fetch itself rejected — offline, DNS, etc.),
 *  never an "expired" outcome (the request never reached the server to say
 *  so). */
export function networkFailure(message: string): ApiFailure {
  return { ok: false, expired: false, message };
}

export const NETWORK_ERROR_MESSAGE = "Network error — check your connection and try again.";
