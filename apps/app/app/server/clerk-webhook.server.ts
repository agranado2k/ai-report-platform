// The Clerk webhook handler (server-only), extracted from the route so every
// branch is unit-testable with injected deps (no Svix, env, or DB) — the same
// DI convention as resolve-actor.server.ts. The route (webhooks.clerk.ts) is a
// thin wiring shim over this.
//
// Two events are handled:
//   - `user.deleted` (ADR-0054): soft-delete our user row + revoke API keys.
//   - `user.created` (ADR-0074): silent domain auto-join — pre-grant the
//     domain org membership the moment the user exists, BEFORE Clerk's forced
//     org-selection task renders (so it becomes select-not-create). Only the
//     primary VERIFIED email drives the join (an unverified address must never
//     claim a domain — ADR-0068's verified-emails-only invariant); anything
//     less acks 200 and leaves first-write JIT provisioning as the net.
//
// Error contract (both handlers are idempotent, so Svix retries are safe):
//   - transient failure → 500 (Svix redelivers).
//   - user.created permanent failures → 200 + structured console.warn:
//     PlanLimitExceeded (the org's membership cap — a retry can't raise a plan
//     limit) and ValidationError (malformed email). Retrying those would only
//     burn the Svix retry budget on an outcome that cannot change.
import type { HandleUserCreatedDeps, HandleUserDeletedDeps } from "arp-application";
import { handleUserCreated, handleUserDeleted } from "arp-application";
import { methodNotAllowed } from "arp-domain";
import { errorToHttp } from "arp-http";
import { toResponse } from "./http.server";

/** The structural slice of a verified Svix event this handler reads. The real
 *  `verifyWebhook` return type is far richer; we depend only on this shape so
 *  tests can construct events without the SDK. */
export interface ClerkWebhookEvent {
  readonly type: string;
  readonly data: {
    readonly id?: string;
    readonly primary_email_address_id?: string | null;
    readonly email_addresses?: ReadonlyArray<{
      readonly id: string;
      readonly email_address: string;
      readonly verification?: { readonly status?: string } | null;
    }>;
  };
}

export interface ClerkWebhookDeps {
  /** `CLERK_WEBHOOK_SIGNING_SECRET`; undefined → 503 (inert until configured). */
  readonly signingSecret: string | undefined;
  /** Svix signature verification (@clerk/backend's verifyWebhook in prod);
   *  throws on an unsigned/tampered payload → 400. */
  readonly verify: (
    request: Request,
    opts: { readonly signingSecret: string },
  ) => Promise<ClerkWebhookEvent>;
  readonly userDeletedDeps: () => HandleUserDeletedDeps;
  readonly userCreatedDeps: () => HandleUserCreatedDeps;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function handleClerkWebhook(
  request: Request,
  deps: ClerkWebhookDeps,
): Promise<Response> {
  if (request.method !== "POST") {
    // The one 405 wire shape (ADR-0040, RFC 9457 problem+json + Allow header) —
    // shared with the /api/v1 routes and the scan-drain trigger.
    return toResponse(errorToHttp(methodNotAllowed("POST")));
  }

  if (!deps.signingSecret) return json(503, { error: "webhook_not_configured" }); // fail-closed

  let event: ClerkWebhookEvent;
  try {
    event = await deps.verify(request, { signingSecret: deps.signingSecret });
  } catch {
    return json(400, { error: "invalid_signature" }); // unsigned / tampered
  }

  if (event.type === "user.deleted") {
    const clerkUserId = event.data.id;
    if (clerkUserId) {
      const result = await handleUserDeleted(deps.userDeletedDeps(), { clerkUserId });
      // Let Clerk retry on a transient failure — the handler is idempotent.
      if (!result.ok) return json(500, { error: "processing_failed" });
    }
  }

  if (event.type === "user.created") {
    const clerkUserId = event.data.id;
    const email = primaryVerifiedEmail(event);
    if (!clerkUserId || !email) {
      // No verified primary address (or a malformed event) — nothing safe to
      // key a domain join on. Ack: user.created never redelivers with a
      // different payload, and first-write JIT provisioning remains the net.
      console.warn(
        "webhooks.clerk user.created: no verified primary email — skipping domain auto-join " +
          "(first-write JIT provisioning will cover this user; ADR-0074).",
      );
      return json(200, { received: true });
    }
    const result = await handleUserCreated(deps.userCreatedDeps(), { clerkUserId, email });
    if (!result.ok) {
      // Permanent outcomes are ACKED (a Svix retry cannot change them):
      //  - PlanLimitExceeded: the org is at its membership cap → operator alert.
      //  - ValidationError: the email failed the domain rule's parser.
      if (result.error.kind === "PlanLimitExceeded" || result.error.kind === "ValidationError") {
        console.warn(`webhooks.clerk user.created: ${result.error.kind} — ${result.error.message}`);
        return json(200, { received: true });
      }
      return json(500, { error: "processing_failed" }); // transient → Svix retries
    }
  }

  return json(200, { received: true }); // ack everything else (no-op)
}

/** The user's primary email, ONLY if its verification status is "verified".
 *  The primary is resolved via `primary_email_address_id` — never "the first
 *  address" (a user can carry multiple addresses, and joining a domain off a
 *  non-primary or unverified one would let anyone claim a victim domain). */
function primaryVerifiedEmail(event: ClerkWebhookEvent): string | null {
  const primaryId = event.data.primary_email_address_id;
  if (!primaryId) return null;
  const primary = (event.data.email_addresses ?? []).find((a) => a.id === primaryId);
  if (primary?.verification?.status !== "verified") return null;
  return primary.email_address;
}
