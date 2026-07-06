// POST /internal/scan-drain — the async scan worker's HTTP trigger (ADR-0045).
// A Cloudflare Cron Trigger Worker calls this every ~1 min with the shared
// secret; the route reconciles queued scan_jobs into pg-boss and processes a
// batch (Phase-1.5a: the CleanStubScanner verdict promotes monotonically).
//
// Not internet-trusted: gated by a constant-time bearer-secret check, fail-closed
// (SCAN_DRAIN_SECRET is a required env). No cron-overlap lock is needed — pg-boss
// `fetch` claims jobs with FOR UPDATE SKIP LOCKED, so concurrent ticks split the
// work rather than double-process, and the reconcile/processing is idempotent.

import { timingSafeEqual } from "node:crypto";
import type { ActionFunctionArgs } from "@remix-run/node";
import { drainScans } from "arp-application";
import { methodNotAllowed } from "arp-domain";
import { defineEnv } from "arp-env";
import { errorToHttp } from "arp-http";
import { scanDrainDeps } from "../server/container.server";
import { toResponse } from "../server/http.server";

/** Jobs claimed per tick — bounded so a drain stays well under Vercel's 300s limit. */
const BATCH_SIZE = 20;

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function bearerToken(header: string | null): string | undefined {
  if (!header) return undefined;
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : undefined;
}

function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual requires equal lengths; a length mismatch is simply a miss.
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    // The one 405 wire shape (ADR-0040, RFC 9457 problem+json + Allow header) —
    // shared with the /api/v1 routes and the Clerk webhook.
    return toResponse(errorToHttp(methodNotAllowed("POST")));
  }

  const env = defineEnv();
  // Fail-closed: if the secret isn't provisioned yet (Terraform not applied),
  // the drain refuses rather than running unauthenticated.
  if (!env.SCAN_DRAIN_SECRET) {
    return jsonResponse(503, { error: "scan_drain_not_configured" });
  }
  const provided = bearerToken(request.headers.get("authorization"));
  if (!provided || !secretMatches(provided, env.SCAN_DRAIN_SECRET)) {
    return jsonResponse(401, { error: "unauthorized" });
  }

  const result = await drainScans(await scanDrainDeps(), { batchSize: BATCH_SIZE });
  if (!result.ok) {
    return jsonResponse(500, { error: "drain_failed", detail: result.error.kind });
  }
  return jsonResponse(200, { drained: result.value.processed, failed: result.value.failed });
}
