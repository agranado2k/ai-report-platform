// POST /webhooks/clerk — inbound Clerk webhook (ADR-0054). Currently mirrors
// `user.deleted`: soft-delete our user row + revoke their API keys (handleUserDeleted).
//
// NOT Clerk-session authed — trust comes from the Svix signature, verified by
// @clerk/backend's verifyWebhook against CLERK_WEBHOOK_SIGNING_SECRET. Fails CLOSED:
// no secret → 503 (inert until configured); bad signature → 400. Every other event
// type is acked 200 (no-op) so Clerk doesn't retry. A processing error returns 500 so
// Clerk retries (handleUserDeleted is idempotent, so a retry is safe).
import { verifyWebhook } from "@clerk/backend/webhooks";
import type { ActionFunctionArgs } from "@remix-run/node";
import { handleUserDeleted } from "arp-application";
import { defineEnv } from "arp-env";
import { userWebhookDeps } from "../server/container.server";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "content-type": "application/json", allow: "POST" },
    });
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
