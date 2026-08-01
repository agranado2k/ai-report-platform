// Unit tests for the Clerk webhook handler (clerk-webhook.server.ts). Signature
// verification, env, and the use-case deps are all injected, so the WHOLE
// dispatch — fail-closed config, signature rejection, the user.created
// auto-join branch (ADR-0074) incl. its ack-vs-retry error contract, and the
// user.deleted soft-delete branch (ADR-0054) — is provable without Svix, env,
// or a database.
import {
  FakeClerkOrgProvisioner,
  InMemoryApiKeyStore,
  InMemoryIdentityStore,
} from "arp-application/testing";
import { describe, expect, it, vi } from "vitest";
import {
  type ClerkWebhookDeps,
  type ClerkWebhookEvent,
  handleClerkWebhook,
} from "./clerk-webhook.server";

function post(body = "{}"): Request {
  return new Request("https://app.example.test/webhooks/clerk", { method: "POST", body });
}

function makeDeps(
  event: ClerkWebhookEvent | Error,
  over: Partial<ClerkWebhookDeps> = {},
): ClerkWebhookDeps & {
  identities: InMemoryIdentityStore;
  clerkOrgs: FakeClerkOrgProvisioner;
  apiKeys: InMemoryApiKeyStore;
} {
  const identities = new InMemoryIdentityStore();
  const clerkOrgs = new FakeClerkOrgProvisioner();
  const apiKeys = new InMemoryApiKeyStore();
  return {
    identities,
    clerkOrgs,
    apiKeys,
    signingSecret: "whsec_test",
    verify: async () => {
      if (event instanceof Error) throw event;
      return event;
    },
    userDeletedDeps: () => ({ identities, apiKeys }),
    userCreatedDeps: () => ({ identities, clerkOrgs }),
    ...over,
  };
}

type EmailAddressEntry = NonNullable<ClerkWebhookEvent["data"]["email_addresses"]>[number];

/** A user.created event whose primary email is verified (the happy shape). */
function userCreated(
  over: Partial<{
    id: string;
    primary: string | null;
    addresses: readonly EmailAddressEntry[];
  }> = {},
): ClerkWebhookEvent {
  return {
    type: "user.created",
    data: {
      id: over.id ?? "u_new",
      primary_email_address_id: over.primary === undefined ? "em_1" : over.primary,
      email_addresses: over.addresses ?? [
        {
          id: "em_1",
          email_address: "new@housenumbers.io",
          verification: { status: "verified" },
        },
        {
          id: "em_2",
          email_address: "spoof@victim.example",
          verification: { status: "unverified" },
        },
      ],
    },
  };
}

describe("handleClerkWebhook", () => {
  it("rejects non-POST with the shared 405 wire shape", async () => {
    const deps = makeDeps(userCreated());
    const res = await handleClerkWebhook(
      new Request("https://app.example.test/webhooks/clerk", { method: "GET" }),
      deps,
    );
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });

  it("fails closed with 503 when no signing secret is configured", async () => {
    const deps = makeDeps(userCreated(), { signingSecret: undefined });
    const res = await handleClerkWebhook(post(), deps);
    expect(res.status).toBe(503);
  });

  it("returns 400 on a bad signature (verify throws)", async () => {
    const deps = makeDeps(new Error("bad sig"));
    const res = await handleClerkWebhook(post(), deps);
    expect(res.status).toBe(400);
  });

  it("acks unrelated event types with 200 (no-op)", async () => {
    const deps = makeDeps({ type: "session.created", data: { id: "sess_1" } });
    const res = await handleClerkWebhook(post(), deps);
    expect(res.status).toBe(200);
  });

  describe("user.created (ADR-0074 silent domain auto-join)", () => {
    it("joins/creates the team org for a verified corporate primary email → 200", async () => {
      const deps = makeDeps(userCreated());
      const res = await handleClerkWebhook(post(), deps);

      expect(res.status).toBe(200);
      // First sign-up at the domain → org created (creator auto-admin) + row indexed.
      expect(deps.clerkOrgs.teamOrgCalls).toEqual([
        { domain: "housenumbers.io", createdBy: "u_new" },
      ]);
      const indexed = await deps.identities.findTeamOrgByDomain("housenumbers.io");
      expect(indexed.ok && indexed.value).not.toBeNull();
    });

    it("uses ONLY the primary email — a verified secondary never drives the join", async () => {
      const deps = makeDeps(
        userCreated({
          addresses: [
            {
              id: "em_1",
              email_address: "real@acme.example",
              verification: { status: "verified" },
            },
            {
              id: "em_2",
              email_address: "other@victim.example",
              verification: { status: "verified" },
            },
          ],
        }),
      );
      const res = await handleClerkWebhook(post(), deps);

      expect(res.status).toBe(200);
      expect(deps.clerkOrgs.teamOrgCalls).toEqual([{ domain: "acme.example", createdBy: "u_new" }]);
    });

    it("acks 200 without joining when the primary email is UNVERIFIED (first-write JIT remains the net)", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const deps = makeDeps(
        userCreated({
          addresses: [
            {
              id: "em_1",
              email_address: "unverified@acme.example",
              verification: { status: "unverified" },
            },
          ],
        }),
      );
      const res = await handleClerkWebhook(post(), deps);

      expect(res.status).toBe(200);
      expect(deps.clerkOrgs.teamOrgCalls).toHaveLength(0);
      expect(deps.clerkOrgs.membershipCalls).toHaveLength(0);
      warn.mockRestore();
    });

    it("acks 200 without joining when there is no primary email at all", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const deps = makeDeps(userCreated({ primary: null, addresses: [] }));
      const res = await handleClerkWebhook(post(), deps);

      expect(res.status).toBe(200);
      expect(deps.clerkOrgs.teamOrgCalls).toHaveLength(0);
      warn.mockRestore();
    });

    it("acks 200 for a personal (public-provider) address — nothing to pre-join", async () => {
      const deps = makeDeps(
        userCreated({
          addresses: [
            { id: "em_1", email_address: "ann@gmail.com", verification: { status: "verified" } },
          ],
        }),
      );
      const res = await handleClerkWebhook(post(), deps);

      expect(res.status).toBe(200);
      expect(deps.clerkOrgs.teamOrgCalls).toHaveLength(0);
      expect(deps.clerkOrgs.calls).toHaveLength(0);
    });

    it("acks the member-cap error with 200 + a structured warn (retries can't fix a plan cap)", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const deps = makeDeps(userCreated());
      deps.clerkOrgs.addClerkOrg("org_full", { name: "Full", anchor: "housenumbers.io" });
      await deps.identities.upsertTeamOrg({
        clerkOrgId: "org_full",
        name: "Full",
        domain: "housenumbers.io",
      });
      deps.clerkOrgs.memberCapReached = true;

      const res = await handleClerkWebhook(post(), deps);

      expect(res.status).toBe(200);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("membership cap"));
      warn.mockRestore();
    });

    it("returns 500 on a transient failure so Svix retries (handler is idempotent)", async () => {
      const deps = makeDeps(userCreated());
      deps.clerkOrgs.createTeamOrg = async () => ({
        ok: false,
        error: { kind: "Unexpected", message: "clerk down" },
      });

      const res = await handleClerkWebhook(post(), deps);

      expect(res.status).toBe(500);
    });
  });

  describe("user.deleted (ADR-0054 — regression)", () => {
    it("soft-deletes the mirrored user and acks 200", async () => {
      const deps = makeDeps({ type: "user.deleted", data: { id: "u_gone" } });
      await deps.identities.createIdentity({
        clerkUserId: "u_gone",
        clerkOrgId: "org_1",
        email: "gone@gmail.com",
        displayName: null,
        orgName: "gone's workspace",
        kind: "personal",
      });

      const res = await handleClerkWebhook(post(), deps);

      expect(res.status).toBe(200);
      const found = await deps.identities.findByClerk("u_gone", "org_1");
      expect(found.ok && found.value).toBeNull();
    });

    it("returns 500 when the soft-delete cascade fails (Svix retries)", async () => {
      const deps = makeDeps({ type: "user.deleted", data: { id: "u_gone" } });
      await deps.identities.createIdentity({
        clerkUserId: "u_gone",
        clerkOrgId: "org_1",
        email: "gone@gmail.com",
        displayName: null,
        orgName: "gone's workspace",
        kind: "personal",
      });
      deps.apiKeys.failRevokeAllForUser = true;

      const res = await handleClerkWebhook(post(), deps);

      expect(res.status).toBe(500);
    });
  });
});
