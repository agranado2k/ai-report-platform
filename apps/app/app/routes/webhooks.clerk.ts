// POST /webhooks/clerk — inbound Clerk webhook. Thin wiring over
// handleClerkWebhook (clerk-webhook.server.ts), where the branch logic and its
// unit tests live. Handles:
//   - `user.deleted` (ADR-0054): soft-delete our user row + revoke API keys.
//   - `user.created` (ADR-0074): silent domain auto-join — a team-domain user
//     is pre-joined to their domain's canonical org (DB domain index → anchor
//     scan → create) the moment they exist, so Clerk's forced org-selection
//     task becomes select-not-create. Primary VERIFIED email only. The ORG row
//     is recorded here (it IS the join index under the free-plan architecture);
//     the USER row still mirrors at first write (ADR-0048).
//
// NOT Clerk-session authed — trust comes from the Svix signature, verified by
// @clerk/backend's verifyWebhook against CLERK_WEBHOOK_SIGNING_SECRET. Fails
// CLOSED: no secret → 503 (inert until configured); bad signature → 400. Every
// other event type is acked 200 (no-op). Transient processing errors return
// 500 (Svix retries; both handlers are idempotent); user.created's permanent
// failures (membership cap, malformed email) are acked 200 + warn — a retry
// can't change them.
//
// ADR-0068 §3/§4 evaluation — still deliberately NOT wiring
// `organizationMembership.*` or `organization.*` here: there is no local
// membership table to sync (membership lives ONLY in Clerk, checked live at
// every gate), and under domain-keyed auto-join a "removed" member would
// silently REJOIN on their next sign-in anyway — persistent removal needs a
// don't-auto-rejoin mechanism this epic doesn't build. Revisit alongside the
// deferred membership-management admin surface (ADR-0068 §4/§5).
import { verifyWebhook } from "@clerk/backend/webhooks";
import type { ActionFunctionArgs } from "@remix-run/node";
import { defineEnv } from "arp-env";
import { handleClerkWebhook } from "../server/clerk-webhook.server";
import { userCreatedDeps, userWebhookDeps } from "../server/container.server";

export async function action({ request }: ActionFunctionArgs) {
  return handleClerkWebhook(request, {
    signingSecret: defineEnv().CLERK_WEBHOOK_SIGNING_SECRET,
    verify: (req, opts) => verifyWebhook(req, opts),
    userDeletedDeps: userWebhookDeps,
    userCreatedDeps: userCreatedDeps,
  });
}
