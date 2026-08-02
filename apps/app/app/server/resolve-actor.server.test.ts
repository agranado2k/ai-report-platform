// Unit tests for the four-door actor-resolution module (resolve-actor.server.ts).
// Every door's I/O is injected, so the WHOLE cascade — order, terminal-vs-fall-
// through behavior per door, read/write differences (JIT provisioning only on
// write; null-vs-401 at the end), and the STRUCTURAL slug gate on the edit-token
// door — is provable here without a Clerk session, env, or database.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { SELF_SCOPES } from "arp-application";
import {
  FakeClerkOrgProvisioner,
  InMemoryApiKeyStore,
  InMemoryIdentityStore,
} from "arp-application/testing";
import { orgId, userId } from "arp-domain";
import { describe, expect, it, vi } from "vitest";
import type { EditTokenActor } from "./edit-token-actor.server";
import {
  type ClerkSessionAuth,
  EDIT_TOKEN_SCOPES,
  type ResolveActorDeps,
  resolveActor,
} from "./resolve-actor.server";

const aUserId = userId("00000000-0000-7000-8000-0000000000d1");
const anOrgId = orgId("00000000-0000-7000-8000-0000000000a1");

function args(headers: Record<string, string> = {}, params: Record<string, string> = {}) {
  return {
    request: new Request("https://app.example.test/api/v1/reports", { headers }),
    params,
    context: {},
  } as LoaderFunctionArgs;
}

/** Baseline deps: every door closed (no key matches, no session, no OAuth
 *  subject, edit-token secret unset). Tests open exactly the doors they need. */
function makeDeps(overrides: Partial<ResolveActorDeps> = {}): ResolveActorDeps {
  return {
    apiKeys: new InMemoryApiKeyStore(),
    session: async (): Promise<ClerkSessionAuth> => ({
      userId: null,
      orgId: null,
      sessionClaims: null,
    }),
    provision: {
      identities: new InMemoryIdentityStore(),
      clerkOrgs: new FakeClerkOrgProvisioner(),
    },
    oauth: { verify: async () => null, fetchIdentity: vi.fn() },
    editTokenDeps: {
      reports: {} as never,
      writeGrant: {} as never,
      secret: undefined, // fail closed — no token is ever trusted
      nowSeconds: () => 0,
    },
    ...overrides,
  };
}

async function seededApiKeys(scopes: readonly string[] = ["reports:write"]) {
  const store = new InMemoryApiKeyStore();
  const created = await store.create({
    actingUserId: aUserId,
    issuedInOrgId: anOrgId,
    name: "test",
    scopes,
  });
  if (!created.ok) throw new Error("could not seed key");
  return { store, token: created.value.token };
}

describe("door 1 — arp_ API key", () => {
  it("write: a valid arp_ Bearer resolves to the key's principal (scopes pass through, folderId = the org root)", async () => {
    const { store, token } = await seededApiKeys(["reports:write", "acl:write"]);
    const deps = makeDeps({ apiKeys: store });
    const r = await resolveActor(
      args({ authorization: `Bearer ${token}` }),
      { mode: "write" },
      deps,
    );
    expect(r.ok && r.value).toMatchObject({
      userId: aUserId,
      orgId: anOrgId,
      scopes: ["reports:write", "acl:write"],
    });
    expect(r.ok && r.value.folderId).toBeTruthy();
  });

  it("write: a present-but-unmatched arp_ key is a TERMINAL 401 — never falls through to later doors", async () => {
    const session = vi.fn();
    const deps = makeDeps({ session });
    const r = await resolveActor(
      args({ authorization: "Bearer arp_nope" }),
      { mode: "write" },
      deps,
    );
    expect(!r.ok && r.error.kind).toBe("Unauthenticated");
    expect(session).not.toHaveBeenCalled();
  });

  it("read: a present-but-unmatched arp_ key reads as null (empty list), still terminal", async () => {
    const session = vi.fn();
    const deps = makeDeps({ session });
    const r = await resolveActor(
      args({ authorization: "Bearer arp_nope" }),
      { mode: "read" },
      deps,
    );
    expect(r.ok && r.value).toBeNull();
    expect(session).not.toHaveBeenCalled();
  });

  it("a non-arp_ Bearer (e.g. a Clerk JWT) does NOT engage the API-key door", async () => {
    const store = new InMemoryApiKeyStore();
    const verify = vi.spyOn(store, "verify");
    const r = await resolveActor(
      args({ authorization: "Bearer eyJhbGciOi.something.else" }),
      { mode: "read" },
      makeDeps({ apiKeys: store }),
    );
    expect(r.ok && r.value).toBeNull();
    expect(verify).not.toHaveBeenCalled();
  });

  it("propagates a store failure (infra, not auth)", async () => {
    const failing = {
      verify: async () => ({ ok: false as const, error: { kind: "Unexpected", message: "db" } }),
    };
    const r = await resolveActor(
      args({ authorization: "Bearer arp_x" }),
      { mode: "write" },
      makeDeps({ apiKeys: failing as never }),
    );
    expect(!r.ok && r.error.kind).toBe("Unexpected");
  });
});

describe("door 2 — Clerk session", () => {
  it("write: provisions the identity JIT (ADR-0048) and returns the full write actor", async () => {
    const deps = makeDeps({
      session: async () => ({
        userId: "clerk-u1",
        orgId: null,
        sessionClaims: { email: "ada@gmail.com", name: "Ada Lovelace" },
      }),
    });
    const r = await resolveActor(args(), { mode: "write" }, deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.scopes).toEqual(SELF_SCOPES);
    expect(r.value.folderId).toBeTruthy();
    // JIT provisioning actually ran: the mirror can now be read back.
    const provisioner = deps.provision.clerkOrgs as FakeClerkOrgProvisioner;
    expect(provisioner.calls.length).toBe(1);
  });

  it("write: a session missing the email claim is a terminal 401 (cannot provision)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await resolveActor(
      args(),
      { mode: "write" },
      makeDeps({
        session: async () => ({ userId: "clerk-u1", orgId: null, sessionClaims: {} }),
      }),
    );
    expect(!r.ok && r.error.kind).toBe("Unauthenticated");
    warn.mockRestore();
  });

  it("read: a mirror miss lazily provisions — ONCE, via the same door as writes (ADR-0048 amendment)", async () => {
    const provision = {
      identities: new InMemoryIdentityStore(),
      clerkOrgs: new FakeClerkOrgProvisioner(),
    };
    provision.clerkOrgs.personalOrgId = null; // no org yet → never uploaded, never read
    const r = await resolveActor(
      args(),
      { mode: "read" },
      makeDeps({
        provision,
        session: async () => ({
          userId: "clerk-u1",
          orgId: null,
          sessionClaims: { email: "ada@gmail.com", name: "Ada Lovelace" },
        }),
      }),
    );
    // A genuine member who has only ever viewed (review #150 H-1 generalized)
    // resolves to a real actor instead of the empty dashboard.
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value?.scopes).toEqual(SELF_SCOPES);
    expect(r.value?.folderId).toBeTruthy();
    expect(provision.clerkOrgs.calls.length).toBe(1); // provisioned exactly once
  });

  it("read: a mirror miss with NO email claim resolves to null — never provisions, never 401s", async () => {
    const provision = {
      identities: new InMemoryIdentityStore(),
      clerkOrgs: new FakeClerkOrgProvisioner(),
    };
    provision.clerkOrgs.personalOrgId = null;
    const r = await resolveActor(
      args(),
      { mode: "read" },
      makeDeps({
        provision,
        session: async () => ({ userId: "clerk-u1", orgId: null, sessionClaims: {} }),
      }),
    );
    expect(r.ok && r.value).toBeNull(); // empty dashboard, exactly as before
    expect(provision.clerkOrgs.calls).toEqual([]); // createPersonalOrg never called
  });

  it("read: an already-mirrored user resolves with SELF_SCOPES via the personal-org lookup", async () => {
    const provision = {
      identities: new InMemoryIdentityStore(),
      clerkOrgs: new FakeClerkOrgProvisioner(),
    };
    const created = await provision.identities.createIdentity({
      clerkUserId: "clerk-u1",
      clerkOrgId: "clerk-org-1",
      email: "ada@gmail.com",
      displayName: null,
      orgName: "ada's workspace",
      kind: "personal",
    });
    if (!created.ok) throw new Error("seed failed");
    provision.clerkOrgs.personalOrgId = "clerk-org-1";
    const r = await resolveActor(
      args(),
      { mode: "read" },
      makeDeps({
        provision,
        session: async () => ({ userId: "clerk-u1", orgId: null, sessionClaims: {} }),
      }),
    );
    expect(r.ok && r.value).toMatchObject({
      userId: created.value.userId,
      orgId: created.value.orgId,
      scopes: SELF_SCOPES,
    });
    // Steady state: the lazy-provision fallback (ADR-0048 amendment) only fires
    // on a mirror MISS — a mirrored read stays a pure lookup, no Clerk/DB write.
    expect(provision.clerkOrgs.calls).toEqual([]);
  });
});

describe("door 3 — forwarded Clerk OAuth token", () => {
  it("write: verifies, fetches the identity (email), and provisions into the personal org", async () => {
    const provision = {
      identities: new InMemoryIdentityStore(),
      clerkOrgs: new FakeClerkOrgProvisioner(),
    };
    const fetchIdentity = vi
      .fn()
      .mockResolvedValue({ ok: true, value: { email: "ada@gmail.com", displayName: "Ada" } });
    const r = await resolveActor(
      args({ authorization: "Bearer eyJoauth" }),
      { mode: "write" },
      makeDeps({ provision, oauth: { verify: async () => "clerk-u9", fetchIdentity } }),
    );
    expect(r.ok).toBe(true);
    expect(fetchIdentity).toHaveBeenCalledWith("clerk-u9");
  });

  it("read: never fetches the identity email (reads don't pay that round-trip)", async () => {
    const fetchIdentity = vi.fn();
    const r = await resolveActor(
      args({ authorization: "Bearer eyJoauth" }),
      { mode: "read" },
      makeDeps({ oauth: { verify: async () => "clerk-u9", fetchIdentity } }),
    );
    expect(r.ok && r.value).toBeNull(); // unmirrored → null, no provisioning
    expect(fetchIdentity).not.toHaveBeenCalled();
  });

  it("write: a no-email OAuth identity is a terminal 401", async () => {
    const fetchIdentity = vi.fn().mockResolvedValue({
      ok: false,
      error: { kind: "Unauthenticated", message: "no verified email" },
    });
    const r = await resolveActor(
      args({ authorization: "Bearer eyJoauth" }),
      { mode: "write" },
      makeDeps({ oauth: { verify: async () => "clerk-u9", fetchIdentity } }),
    );
    expect(!r.ok && r.error.kind).toBe("Unauthenticated");
  });
});

describe("door 4 — slug-bound edit token (ADR-0063)", () => {
  const editActor: EditTokenActor = {
    userId: aUserId,
    orgId: anOrgId,
    folderId: "00000000-0000-7000-8000-0000000000f1" as never,
  };

  it("is STRUCTURALLY disabled when the route has no :slug param — the acceptor is never invoked", async () => {
    const accept = vi.fn().mockResolvedValue(editActor);
    const r = await resolveActor(
      args({ authorization: "Bearer some-edit-token" }),
      { mode: "write" },
      makeDeps(),
      accept,
    );
    expect(!r.ok && r.error.kind).toBe("Unauthenticated");
    expect(accept).not.toHaveBeenCalled();
  });

  it("write: resolves with EXACTLY the reports:write scope (never acl:write) and the report's own folder", async () => {
    const accept = vi.fn().mockResolvedValue(editActor);
    const r = await resolveActor(
      args({ authorization: "Bearer some-edit-token" }),
      { mode: "write", slug: "abc1234567" },
      makeDeps(),
      accept,
    );
    expect(r.ok && r.value).toEqual({
      userId: aUserId,
      orgId: anOrgId,
      folderId: editActor.folderId,
      scopes: EDIT_TOKEN_SCOPES,
    });
    // The acceptor got the ROUTE's own slug — the slug-binding trust boundary.
    expect(accept.mock.calls[0]?.[1]).toBe("abc1234567");
  });

  it("read: same narrow scopes — an edit-token actor can never read ACL config through this seam", async () => {
    const accept = vi.fn().mockResolvedValue(editActor);
    const r = await resolveActor(
      args({ authorization: "Bearer some-edit-token" }),
      { mode: "read", slug: "abc1234567" },
      makeDeps(),
      accept,
    );
    expect(r.ok && r.value?.scopes).toEqual(EDIT_TOKEN_SCOPES);
  });

  it("a rejected token falls through to the terminal no-credential outcome", async () => {
    const accept = vi.fn().mockResolvedValue(null);
    const r = await resolveActor(
      args({ authorization: "Bearer bad" }),
      { mode: "read", slug: "abc1234567" },
      makeDeps(),
      accept,
    );
    expect(r.ok && r.value).toBeNull();
  });
});

describe("cascade order + terminal outcomes", () => {
  it("API key beats the session door (a Bearer arp_ never reaches Clerk)", async () => {
    const { store, token } = await seededApiKeys();
    const session = vi.fn();
    const r = await resolveActor(
      args({ authorization: `Bearer ${token}` }),
      { mode: "write" },
      makeDeps({ apiKeys: store, session }),
    );
    expect(r.ok).toBe(true);
    expect(session).not.toHaveBeenCalled();
  });

  it("session beats the OAuth door (verify is never called for a signed-in request)", async () => {
    const verify = vi.fn();
    const provision = {
      identities: new InMemoryIdentityStore(),
      clerkOrgs: new FakeClerkOrgProvisioner(),
    };
    const r = await resolveActor(
      args(),
      { mode: "write" },
      makeDeps({
        provision,
        session: async () => ({
          userId: "clerk-u1",
          orgId: null,
          sessionClaims: { email: "ada@gmail.com" },
        }),
        oauth: { verify, fetchIdentity: vi.fn() },
      }),
    );
    expect(r.ok).toBe(true);
    expect(verify).not.toHaveBeenCalled();
  });

  it("OAuth beats the edit-token door (a verified OAuth subject is terminal)", async () => {
    const accept = vi.fn();
    const r = await resolveActor(
      args({ authorization: "Bearer eyJoauth" }),
      { mode: "read", slug: "abc1234567" },
      makeDeps({ oauth: { verify: async () => "clerk-u9", fetchIdentity: vi.fn() } }),
      accept,
    );
    expect(r.ok && r.value).toBeNull(); // unmirrored read → null
    expect(accept).not.toHaveBeenCalled();
  });

  it("write with no credential at all → the canonical Unauthenticated error", async () => {
    const r = await resolveActor(args(), { mode: "write" }, makeDeps());
    expect(!r.ok && r.error).toEqual({
      kind: "Unauthenticated",
      message: "a session, API key, or OAuth token is required",
    });
  });

  it("read with no credential at all → ok(null)", async () => {
    const r = await resolveActor(args(), { mode: "read" }, makeDeps());
    expect(r.ok && r.value).toBeNull();
  });
});
