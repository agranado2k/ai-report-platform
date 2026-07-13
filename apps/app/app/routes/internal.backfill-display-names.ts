// POST /internal/backfill-display-names — the ONE-TIME, OPERATOR-run job that
// populates `users.display_name` for accounts mirrored before ADR-0063's JIT
// capture shipped (roadmap #59). It touches prod Clerk (PII) + the prod DB, so
// it is NOT part of any build/deploy and NOT cron-triggered: it runs only when
// an operator explicitly POSTs with the shared secret. Fail-closed like
// /internal/scan-drain — a constant-time bearer check, 503 when the secret is
// unset, 401 on a mismatch. Idempotent + safe to re-run (the use case only ever
// writes a currently-null name; see setDisplayNameIfNull's `IS NULL` guard).
//
// ── How the operator runs it ──────────────────────────────────────────────
// Prereqs (env on the target deployment): CLERK_SECRET_KEY + DATABASE_URL are
// already set. Transiently set DISPLAY_NAME_BACKFILL_SECRET to a random value to
// arm the endpoint, then REMOVE it once the job is done (keep the window small).
//
//   # 1) DRY RUN (default — reports what WOULD change, writes NOTHING):
//   curl -sS -X POST https://<app-origin>/internal/backfill-display-names \
//     -H "authorization: Bearer $DISPLAY_NAME_BACKFILL_SECRET"
//
//   # 2) APPLY (writes the names). `apply=true` is required to mutate:
//   curl -sS -X POST "https://<app-origin>/internal/backfill-display-names?apply=true" \
//     -H "authorization: Bearer $DISPLAY_NAME_BACKFILL_SECRET"
//
// Optional query params: `batchSize` (page size, default 100, 1..500) and
// `maxUsers` (per-request scan cap — use to run in bounded chunks against a
// large table; omit to drain). The response is a JSON summary:
//   { "dryRun": bool, "scanned": n, "updated": n, "skipped": n, "errors": n }
// Only counts are returned/logged — never names or emails (PII).

import type { ActionFunctionArgs } from "@remix-run/node";
import { backfillDisplayNames } from "arp-application";
import { methodNotAllowed } from "arp-domain";
import { defineEnv } from "arp-env";
import { errorToHttp, secretMatches } from "arp-http";
import { backfillDisplayNamesDeps } from "../server/container.server";
import { toResponse } from "../server/http.server";

/** Default page size — bounded so one page never loads the whole users table. */
const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function bearerToken(header: string | null): string | undefined {
  if (!header) return undefined;
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : undefined;
}

/** Parse a positive-integer query param within [min, max], else the fallback. */
function intParam(url: URL, name: string, fallback: number, min: number, max: number): number {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min) return fallback;
  return Math.min(n, max);
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return toResponse(errorToHttp(methodNotAllowed("POST")));
  }

  const env = defineEnv();
  // Fail-closed: the secret is normally UNSET (the endpoint is inert) — refuse
  // rather than run an unauthenticated PII-touching job.
  if (!env.DISPLAY_NAME_BACKFILL_SECRET) {
    return jsonResponse(503, { error: "backfill_not_configured" });
  }
  const provided = bearerToken(request.headers.get("authorization"));
  if (!provided || !secretMatches(provided, env.DISPLAY_NAME_BACKFILL_SECRET)) {
    return jsonResponse(401, { error: "unauthorized" });
  }

  const url = new URL(request.url);
  // Fail-safe: apply ONLY on an explicit `apply=true`; anything else is a dry run.
  const dryRun = url.searchParams.get("apply") !== "true";
  const batchSize = intParam(url, "batchSize", DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  // `maxUsers` omitted → drain (undefined). But an EXPLICIT, unparseable value
  // must NOT silently fall back to a cap — a fat-fingered `?maxUsers=abc` on an
  // intended-unbounded run would then silently stop at 100. Reject it (400).
  const maxUsersRaw = url.searchParams.get("maxUsers");
  let maxUsers: number | undefined;
  if (maxUsersRaw !== null) {
    const n = Number.parseInt(maxUsersRaw, 10);
    if (!Number.isFinite(n) || n < 1) {
      return jsonResponse(400, { error: "invalid_maxUsers" });
    }
    maxUsers = Math.min(n, 1_000_000);
  }

  const result = await backfillDisplayNames(backfillDisplayNamesDeps(), {
    batchSize,
    dryRun,
    maxUsers,
  });
  if (!result.ok) {
    return jsonResponse(500, { error: "backfill_failed", detail: result.error.kind });
  }
  // Count-only summary — no names/emails (PII) in the response or logs.
  const summary = { dryRun, ...result.value };
  console.info(`backfill-display-names: ${JSON.stringify(summary)}`);
  return jsonResponse(200, summary);
}
