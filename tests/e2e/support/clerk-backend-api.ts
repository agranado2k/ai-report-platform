// The one place a Clerk Backend API request is shaped. Split out of
// `clerk-session.ts` so the fixture-sweep layer (`clerk-fixture-sweep.ts`) and
// the global setup/teardown can call BAPI without importing the session-minting
// module — and so there is exactly one definition of the base URL and the
// Authorization header. Raw `fetch` keeps `@clerk/backend` out of the tree.

export const CLERK_API = "https://api.clerk.com/v1";

export async function clerkFetch(
  path: string,
  secretKey: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`${CLERK_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${secretKey}`, ...(init?.headers ?? {}) },
  });
}

/** Transient statuses worth another attempt. 429 is not hypothetical here:
 *  three stacked PRs smoking in parallel against this shared dev instance
 *  produced `clerk users lookup failed: 429` (issue #266, second comment). */
function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface DeleteOutcome {
  readonly ok: boolean;
  /** Populated only when `ok` is false — the reason to print. */
  readonly reason?: string;
}

/**
 * DELETE a Clerk object, tolerantly.
 *
 * A 404 is SUCCESS: the object is gone, which is the whole goal, and the
 * cleanup paths deliberately overlap (per-scenario hook, registry purge,
 * opportunistic sweep) so the second one to arrive must not report a failure.
 *
 * Retries on 429/5xx with exponential backoff, because the previous cleanup
 * swallowed exactly those and the swallowed failure IS the leak. Never throws —
 * the caller decides whether a failed deletion is fatal (the sweep workflow
 * says yes; a test teardown says no).
 */
export async function deleteClerkObject(
  secretKey: string,
  path: string,
  attempts = 3,
): Promise<DeleteOutcome> {
  let lastReason = "no attempt made";

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await clerkFetch(path, secretKey, { method: "DELETE" });
      if (res.ok || res.status === 404) return { ok: true };
      lastReason = `HTTP ${res.status}`;
      if (!isRetryable(res.status)) return { ok: false, reason: lastReason };
    } catch (error) {
      lastReason = error instanceof Error ? error.message : String(error);
    }
    if (attempt < attempts) await sleep(2 ** (attempt - 1) * 1000);
  }

  return { ok: false, reason: `${lastReason} (after ${attempts} attempts)` };
}
