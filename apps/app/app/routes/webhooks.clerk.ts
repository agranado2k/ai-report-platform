// POST /webhooks/clerk — inbound Clerk webhook (ADR-0054). Currently mirrors
// `user.deleted`: soft-delete our user row + revoke their API keys (handleUserDeleted).
//
// NOT Clerk-session authed — trust comes from the Svix signature, verified by
// @clerk/backend's verifyWebhook against CLERK_WEBHOOK_SIGNING_SECRET. Fails CLOSED:
// no secret → 503 (inert until configured); bad signature → 400. Every other event
// type is acked 200 (no-op) so Clerk doesn't retry. A processing error returns 500 so
// Clerk retries (handleUserDeleted is idempotent, so a retry is safe).
//
// ADR-0068 §3/§4 evaluation — deliberately NOT wiring `organizationMembership.*`
// or `organization.*` here: this store has no local membership join table to
// keep in sync (`users` and `orgs` are independent mirror rows; membership
// itself lives ONLY in Clerk and is checked LIVE at every gate — the org-mode
// unlock reads the Clerk-verified session org, `orgUnlock` in
// `unlock.$slug.tsx`; JIT provisioning re-resolves the org from Clerk on every
// sign-in with no active org). So there is no stale cache for a webhook to
// invalidate today. More importantly, handling `organizationMembership.deleted`
// would NOT achieve "a removed member stops resolving": under domain-keyed
// JIT join-or-create (ADR-0068 §1/§3), a removed member who signs in again
// re-derives the SAME team org from their email domain and silently REJOINS
// via `ensureMembership` — persistent removal needs a "don't auto-rejoin"
// tracking mechanism this epic doesn't build (no removal/ban UI exists yet).
// Wiring the event without that machinery would give a false sense of having
// closed the gap. Revisit alongside the deferred ownership-transfer /
// membership-management admin surface (ADR-0068 §4/§5).
import { verifyWebhook } from "@clerk/backend/webhooks";
import type { ActionFunctionArgs } from "@remix-run/node";
import { handleUserDeleted } from "arp-application";
import { methodNotAllowed } from "arp-domain";
import { defineEnv } from "arp-env";
import { errorToHttp } from "arp-http";
import { userWebhookDeps } from "../server/container.server";
import { toResponse } from "../server/http.server";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    // The one 405 wire shape (ADR-0040, RFC 9457 problem+json + Allow header) —
    // shared with the /api/v1 routes and the scan-drain trigger.
    return toResponse(errorToHttp(methodNotAllowed("POST")));
  }

  const signingSecret = defineEnv().CLERK_WEBHOOK_SIGNING_SECRET;
  if (!signingSecret) return json(503, { error: "webhook_not_configured" }); // fail-closed

  let event: Awaited<ReturnType<typeof verifyWebhook>>;
  try {
    event = await verifyWebhook(request, { signingSecret });
  } catch {
    return json(400, { error: "invalid_signature" }); // unsigned / tampered
  }

  if (event.type === "user.deleted") {
    const clerkUserId = event.data.id;
    if (clerkUserId) {
      const result = await handleUserDeleted(userWebhookDeps(), { clerkUserId });
      // Let Clerk retry on a transient failure — the handler is idempotent.
      if (!result.ok) return json(500, { error: "processing_failed" });
    }
  }

  return json(200, { received: true }); // ack everything else (no-op)
}
