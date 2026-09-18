// THE SCAN DRAIN — what makes a PREVIEW's upload servable (ADR-0045 / ADR-0080).
//
// A report only becomes servable once its live version scans `clean`
// (ADR-0037 §8). In production a Cloudflare Cron Trigger Worker calls
// `POST /internal/scan-drain` every ~minute; that Worker targets PROD ONLY, so
// on a PR preview NOTHING promotes an upload past `scan_status: pending`. Any
// scenario that needs a servable report has to drive the drain itself — which
// is why `editor-auth.feature` stopped at the 303 for so long, and why both
// production incidents it now covers (#188's re-nested `/edit` route and the
// ADR-0080 owner lockout) lived on the hop it could not reach.
//
// Extracted here because a SECOND scenario now needs it (#366, the owner-view
// deck): a report that is not servable cannot be framed either, so the owner
// view would wrap chrome around an unlock wall. Two copies of a bounded retry
// loop drift in exactly the way that makes one of them stop proving anything —
// and the loud, specific failure messages below are the most valuable part of
// it, since they name WHICH link in the wiring broke.
//
// The route is fail-closed: 503 when the secret is unset, 401 on a mismatch. So
// a broken wiring is loud, never a silent skip. The secret itself is derived
// INDEPENDENTLY and identically by `preview-isolation.yml` and `e2e.yml` as
// HMAC-SHA256(key = VERCEL_AUTOMATION_BYPASS_SECRET, msg = the PR's head branch
// ref) — the runner redacts registered secrets out of job outputs, so it cannot
// be passed between jobs. Those two expressions must stay byte-identical; when
// they drift, the 401 below is what says so.
import { type APIRequestContext, expect } from "@playwright/test";

export interface DrainOptions {
  /** `E2E_SCAN_DRAIN_SECRET` — the per-PR value both workflows derive. */
  readonly drainSecret: string | undefined;
  /** A Clerk session JWT for the report's owner, to read its versions back. */
  readonly jwt: string;
  /** Bounded: the drain claims a batch per tick and the stub scanner promotes
   *  synchronously, so one tick normally suffices. A few more cover a cold Neon
   *  branch and pg-boss's own first-run bootstrap. */
  readonly attempts?: number;
}

/**
 * Drive `POST /internal/scan-drain` until `slug`'s live version reads back
 * `scan_status: "clean"`, or throw naming the scan pipeline as the failure.
 *
 * Callers are expected to have already skipped when `drainSecret` is absent
 * (a plain local `pnpm e2e` has no preview to drain); passing it in anyway
 * keeps this function honest about what it sends rather than reading
 * `process.env` behind the caller's back.
 */
export async function drainUntilClean(
  api: APIRequestContext,
  slug: string,
  { drainSecret, jwt, attempts = 10 }: DrainOptions,
): Promise<void> {
  const auth = { Authorization: `Bearer ${jwt}` };

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const drained = await api.post("/internal/scan-drain", {
      headers: { Authorization: `Bearer ${drainSecret}` },
    });
    expect(
      drained.status(),
      `POST /internal/scan-drain answered ${drained.status()} — 503 means SCAN_DRAIN_SECRET is unset on the preview, 401 means e2e.yml and preview-isolation.yml derived DIFFERENT values (they must stay byte-identical)`,
    ).toBe(200);

    const versions = await api.get(`/api/v1/reports/${slug}/versions`, { headers: auth });
    expect(versions.status()).toBe(200);
    const body = (await versions.json()) as { data?: { scan_status?: string }[] };
    if (body.data?.[0]?.scan_status === "clean") return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(
    `report ${slug} never reached scan_status: clean after ${attempts} drain ticks — the scan pipeline, not the surface under test, is what failed here`,
  );
}
