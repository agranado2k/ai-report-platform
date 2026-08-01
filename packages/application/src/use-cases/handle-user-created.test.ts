import { describe, expect, it } from "vitest";
import { FakeClerkOrgProvisioner, InMemoryIdentityStore } from "../testing/in-memory";
import { handleUserCreated } from "./handle-user-created";

function deps() {
  return { identities: new InMemoryIdentityStore(), clerkOrgs: new FakeClerkOrgProvisioner() };
}

describe("handleUserCreated (ADR-0074 — silent domain auto-join on Clerk user.created)", () => {
  it("is a no-op for a public-provider address (personal org stays JIT-at-first-write)", async () => {
    const d = deps();
    const r = await handleUserCreated(d, { clerkUserId: "u_ann", email: "ann@gmail.com" });

    expect(r.ok && r.value.outcome).toBe("personal-noop");
    expect(d.clerkOrgs.teamOrgCalls).toHaveLength(0);
    expect(d.clerkOrgs.membershipCalls).toHaveLength(0);
    expect(d.clerkOrgs.calls).toHaveLength(0); // never creates a personal org either
  });

  it("JOINS via the DB domain index when the org row exists (anchor verified)", async () => {
    const d = deps();
    d.clerkOrgs.addClerkOrg("org_hn", { name: "House Numbers", anchor: "housenumbers.io" });
    await d.identities.upsertTeamOrg({
      clerkOrgId: "org_hn",
      name: "House Numbers",
      domain: "housenumbers.io",
    });

    const r = await handleUserCreated(d, {
      clerkUserId: "u_processing",
      email: "processing@housenumbers.io",
    });

    expect(r.ok && r.value.outcome).toBe("joined");
    expect(d.clerkOrgs.membershipCalls).toEqual([
      { clerkOrgId: "org_hn", clerkUserId: "u_processing" },
    ]);
    expect(d.clerkOrgs.teamOrgCalls).toHaveLength(0);
  });

  it("ADOPTS an unmirrored Clerk org via the anchor scan on a DB-index miss (House Numbers shape)", async () => {
    const d = deps();
    // Clerk org exists with the backfilled anchor; our DB has NO row for it.
    d.clerkOrgs.addClerkOrg("org_hn", { name: "House Numbers", anchor: "housenumbers.io" });

    const r = await handleUserCreated(d, {
      clerkUserId: "u_new",
      email: "new@housenumbers.io",
    });

    expect(r.ok && r.value.outcome).toBe("adopted");
    expect(d.clerkOrgs.membershipCalls).toEqual([{ clerkOrgId: "org_hn", clerkUserId: "u_new" }]);
    expect(d.clerkOrgs.teamOrgCalls).toHaveLength(0); // adopted, never created
    // The org row was recorded (kind team, Clerk's display name, indexed domain).
    const indexed = await d.identities.findTeamOrgByDomain("housenumbers.io");
    expect(indexed.ok && indexed.value?.clerkOrgId).toBe("org_hn");
  });

  it("CREATES the team org for the first sign-up at a brand-new domain and records its row", async () => {
    const d = deps();

    const r = await handleUserCreated(d, { clerkUserId: "u_first", email: "first@acme.example" });

    expect(r.ok && r.value.outcome).toBe("created");
    expect(d.clerkOrgs.teamOrgCalls).toEqual([{ domain: "acme.example", createdBy: "u_first" }]);
    // The creator is auto-assigned Clerk org admin — no membership call.
    expect(d.clerkOrgs.membershipCalls).toHaveLength(0);
    const indexed = await d.identities.findTeamOrgByDomain("acme.example");
    expect(indexed.ok && indexed.value?.clerkOrgId).toBe("clerk-team-org-acme.example");
  });

  it("does NOT mirror a USER row — only the org row lands at webhook time (ADR-0048 first-write mirroring)", async () => {
    const d = deps();
    const r = await handleUserCreated(d, { clerkUserId: "u_first", email: "first@acme.example" });
    expect(r.ok).toBe(true);

    const user = await d.identities.findUserIdByEmail("first@acme.example");
    expect(user.ok && user.value).toBeNull();
  });

  it("is idempotent — a Svix redelivery joins the already-created org, minting nothing new", async () => {
    const d = deps();
    await handleUserCreated(d, { clerkUserId: "u_first", email: "first@acme.example" });
    const replay = await handleUserCreated(d, {
      clerkUserId: "u_first",
      email: "first@acme.example",
    });

    expect(replay.ok && replay.value.outcome).toBe("joined"); // index hit this time
    expect(d.clerkOrgs.teamOrgCalls).toHaveLength(1); // still exactly one create
  });

  it("propagates the typed member-cap error so the webhook can ack-not-retry", async () => {
    const d = deps();
    d.clerkOrgs.addClerkOrg("org_full", { name: "Full Org", anchor: "full.example" });
    await d.identities.upsertTeamOrg({
      clerkOrgId: "org_full",
      name: "Full Org",
      domain: "full.example",
    });
    d.clerkOrgs.memberCapReached = true;

    const r = await handleUserCreated(d, { clerkUserId: "u_21st", email: "late@full.example" });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("PlanLimitExceeded");
  });

  it("FAILS CLOSED on an anchor mismatch (index points at an org that doesn't anchor the domain)", async () => {
    const d = deps();
    d.clerkOrgs.addClerkOrg("org_evil", { name: "Evil", anchor: "other.example" });
    await d.identities.upsertTeamOrg({
      clerkOrgId: "org_evil",
      name: "Evil",
      domain: "victim.example",
    });

    const r = await handleUserCreated(d, { clerkUserId: "u_v", email: "v@victim.example" });

    expect(r.ok).toBe(false);
    expect(d.clerkOrgs.membershipCalls).toHaveLength(0); // never joined
  });

  it("rejects a malformed email up front (resolveOrgKey validation)", async () => {
    const d = deps();
    const r = await handleUserCreated(d, { clerkUserId: "u_bad", email: "not-an-email" });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("ValidationError");
  });
});
