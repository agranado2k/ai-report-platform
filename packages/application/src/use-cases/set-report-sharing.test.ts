import { describe, expect, it } from "vitest";
import {
  ACTORS,
  makeGrantCheckDeps,
  makeOwnerMutationDeps,
  report,
  slug,
} from "../testing/fixtures";
import { InMemoryGrantStore } from "../testing/in-memory";
import { setAcl } from "./set-acl";
import { setReportSharing } from "./set-report-sharing";

const { orgA, orgB, owner, otherUser } = ACTORS;
const SLUG = "aaaaaaaaaa";
const ACTOR = { orgId: orgA, userId: owner, scopes: ["acl:write"] };

async function seed(overrides: { readonly ownerId?: typeof owner } = {}) {
  const base = makeOwnerMutationDeps();
  const rpt = report(orgA, SLUG, overrides.ownerId ? { ownerId: overrides.ownerId } : {});
  await base.reports.save(rpt);
  const deps = {
    ...base,
    grants: new InMemoryGrantStore({ now: () => Date.now() }),
    orgWriteGrants: makeGrantCheckDeps().orgWriteGrants,
  };
  return { deps, rpt };
}

describe("setReportSharing (ADR-0078 §3)", () => {
  it("requires the acl:write scope — sharing is sharing (ADR-0016)", async () => {
    const { deps } = await seed();
    const r = await setReportSharing(
      deps,
      { orgId: orgA, userId: owner, scopes: [] },
      { slug: slug(SLUG), sharing: "org_view" },
    );
    expect(!r.ok && r.error.kind).toBe("InsufficientScope");
  });

  it("is OWNER-ONLY — a same-org colleague is refused (ADR-0059 §2)", async () => {
    const { deps } = await seed();
    const r = await setReportSharing(
      deps,
      { orgId: orgA, userId: otherUser, scopes: ["acl:write"] },
      { slug: slug(SLUG), sharing: "org_view" },
    );
    expect(!r.ok && r.error).toEqual({
      kind: "NotAllowed",
      message: "you do not own this report",
    });
  });

  describe("the three states", () => {
    it("org_view sets acl=org and grants NO org write", async () => {
      const { deps, rpt } = await seed();
      const r = await setReportSharing(deps, ACTOR, { slug: slug(SLUG), sharing: "org_view" });
      expect(r.ok && r.value.report.acl.mode).toBe("org");
      expect(r.ok && r.value.sharing).toBe("org_view");
      const grant = await deps.orgWriteGrants.find(rpt.id);
      expect(grant.ok && grant.value).toBeNull();
    });

    it("org_edit sets acl=org AND grants org write — read and write, never write alone", async () => {
      const { deps, rpt } = await seed();
      const r = await setReportSharing(deps, ACTOR, { slug: slug(SLUG), sharing: "org_edit" });
      expect(r.ok && r.value.report.acl.mode).toBe("org");
      const grant = await deps.orgWriteGrants.find(rpt.id);
      expect(grant.ok && grant.value).toMatchObject({ orgId: orgA, grantedBy: owner });
    });

    it("private revokes the org write row as well as closing the acl", async () => {
      const { deps, rpt } = await seed();
      await setReportSharing(deps, ACTOR, { slug: slug(SLUG), sharing: "org_edit" });
      const r = await setReportSharing(deps, ACTOR, { slug: slug(SLUG), sharing: "private" });
      expect(r.ok && r.value.report.acl.mode).toBe("private");
      const grant = await deps.orgWriteGrants.find(rpt.id);
      // Leaving the row behind would be the forbidden combination: org-wide
      // write on a report the org can no longer read (ADR-0060 §6).
      expect(grant.ok && grant.value).toBeNull();
    });

    it("org_edit → org_view drops the write while keeping the read", async () => {
      const { deps, rpt } = await seed();
      await setReportSharing(deps, ACTOR, { slug: slug(SLUG), sharing: "org_edit" });
      const r = await setReportSharing(deps, ACTOR, { slug: slug(SLUG), sharing: "org_view" });
      expect(r.ok && r.value.report.acl.mode).toBe("org");
      const grant = await deps.orgWriteGrants.find(rpt.id);
      expect(grant.ok && grant.value).toBeNull();
    });

    it("re-applying the same state is a no-op in effect and still succeeds", async () => {
      const { deps, rpt } = await seed();
      await setReportSharing(deps, ACTOR, { slug: slug(SLUG), sharing: "org_edit" });
      const r = await setReportSharing(deps, ACTOR, { slug: slug(SLUG), sharing: "org_edit" });
      expect(r.ok && r.value.sharing).toBe("org_edit");
      const grant = await deps.orgWriteGrants.find(rpt.id);
      expect(grant.ok && grant.value).not.toBeNull();
    });
  });

  describe("advanced modes are protected, not clobbered (ADR-0078 §4)", () => {
    const withPassword = async () => {
      const seeded = await seed();
      const r = await setAcl(
        {
          ...seeded.deps,
          hasher: {
            async hash(p: string) {
              return { ok: true as const, value: `h:${p}` };
            },
            async verify() {
              return { ok: true as const, value: true };
            },
          },
        },
        ACTOR,
        { slug: slug(SLUG), mode: "password", password: "hunter2" },
      );
      expect(r.ok).toBe(true);
      return seeded;
    };

    it("REFUSES an unconfirmed change, naming what would be lost", async () => {
      const { deps } = await withPassword();
      const r = await setReportSharing(deps, ACTOR, { slug: slug(SLUG), sharing: "org_view" });
      expect(!r.ok && r.error.kind).toBe("ValidationError");
      if (!r.ok) {
        expect(r.error.message).toContain("remove the password");
        expect(r.error.message).toContain("confirm_discard");
      }
    });

    it("changes NOTHING on that refusal", async () => {
      const { deps, rpt } = await withPassword();
      await setReportSharing(deps, ACTOR, { slug: slug(SLUG), sharing: "org_view" });
      const after = await deps.reports.findById(rpt.id);
      expect(after.ok && after.value?.acl.mode).toBe("password");
    });

    it("proceeds once the caller confirms", async () => {
      const { deps } = await withPassword();
      const r = await setReportSharing(deps, ACTOR, {
        slug: slug(SLUG),
        sharing: "org_view",
        confirmDiscard: true,
      });
      expect(r.ok && r.value.report.acl.mode).toBe("org");
    });

    it("prunes the allowlist's redeemed viewer grants when it leaves that mode", async () => {
      // ADR-0056 "5e" / issue #137: a durable grant must not outlive the Acl
      // that authorized it. This use case reuses setAcl's own prune rather than
      // re-implementing it — the test proves the reuse actually fires.
      const { deps, rpt } = await seed();
      const acl = await setAcl(
        {
          ...deps,
          hasher: {
            async hash() {
              return { ok: true as const, value: "x" };
            },
            async verify() {
              return { ok: true as const, value: true };
            },
          },
        },
        ACTOR,
        { slug: slug(SLUG), mode: "allowlist", allowedEmails: ["a@x.com"] },
      );
      expect(acl.ok).toBe(true);
      await deps.grants.grant(rpt.id, "a@x.com", Date.now() + 60_000);
      expect((await deps.grants.isGranted(rpt.id, "a@x.com")).ok).toBe(true);

      const r = await setReportSharing(deps, ACTOR, {
        slug: slug(SLUG),
        sharing: "private",
        confirmDiscard: true,
      });
      expect(r.ok).toBe(true);
      const still = await deps.grants.isGranted(rpt.id, "a@x.com");
      expect(still.ok && still.value).toBe(false);
    });
  });

  describe("audit (ADR-0070)", () => {
    it("records the TRANSITION, not just the endpoint", async () => {
      const { deps } = await seed();
      await setReportSharing(deps, ACTOR, { slug: slug(SLUG), sharing: "org_view" });
      expect(deps.audit.recorded()).toEqual([
        expect.objectContaining({
          action: "report.sharing_set",
          meta: { from: "private", to: "org_view" },
        }),
      ]);
    });

    it("records an org-write GRANT separately from the sharing change", async () => {
      const { deps } = await seed();
      await setReportSharing(deps, ACTOR, { slug: slug(SLUG), sharing: "org_edit" });
      expect(deps.audit.recorded().map((e) => e.action)).toEqual([
        "report.sharing_set",
        "grant.org_write.granted",
      ]);
    });

    it("records an org-write REVOKE when the row goes away", async () => {
      const { deps } = await seed();
      await setReportSharing(deps, ACTOR, { slug: slug(SLUG), sharing: "org_edit" });
      await setReportSharing(deps, ACTOR, { slug: slug(SLUG), sharing: "private" });
      expect(deps.audit.recorded().map((e) => e.action)).toEqual([
        "report.sharing_set",
        "grant.org_write.granted",
        "report.sharing_set",
        "grant.org_write.revoked",
      ]);
    });

    it("does NOT re-record a grant when the state is merely re-asserted", async () => {
      const { deps } = await seed();
      await setReportSharing(deps, ACTOR, { slug: slug(SLUG), sharing: "org_edit" });
      await setReportSharing(deps, ACTOR, { slug: slug(SLUG), sharing: "org_edit" });
      expect(
        deps.audit.recorded().filter((e) => e.action === "grant.org_write.granted"),
      ).toHaveLength(1);
    });
  });

  describe("idempotency (ADR-0039)", () => {
    it("does NOT engage the derived-key fallback — A → B → A really lands on A", async () => {
      // The set-folder-visibility hazard, verbatim: a derived key is a
      // permanent record, so a state-setting op that used it would replay its
      // first response and never re-save. Here the round trip must actually
      // round-trip.
      const { deps, rpt } = await seed();
      await setReportSharing(deps, ACTOR, { slug: slug(SLUG), sharing: "private" });
      await setReportSharing(deps, ACTOR, { slug: slug(SLUG), sharing: "org_view" });
      const back = await setReportSharing(deps, ACTOR, { slug: slug(SLUG), sharing: "private" });
      expect(back.ok && back.value.sharing).toBe("private");
      const after = await deps.reports.findById(rpt.id);
      expect(after.ok && after.value?.acl.mode).toBe("private");
    });

    it("replays on an EXPLICIT key, without re-executing", async () => {
      const { deps, rpt } = await seed();
      const first = await setReportSharing(deps, ACTOR, {
        slug: slug(SLUG),
        sharing: "org_edit",
        idempotencyKey: "k-1",
      });
      expect(first.ok).toBe(true);
      // Move the report OUT of the state behind the use case's back, then
      // re-send the same key: a replay must return the recorded response and
      // leave the (now different) state alone.
      await deps.orgWriteGrants.revoke(rpt.id);
      const replay = await setReportSharing(deps, ACTOR, {
        slug: slug(SLUG),
        sharing: "org_edit",
        idempotencyKey: "k-1",
      });
      expect(replay.ok && replay.value.sharing).toBe("org_edit");
      const grant = await deps.orgWriteGrants.find(rpt.id);
      expect(grant.ok && grant.value).toBeNull(); // not re-executed
    });
  });

  it("refuses a cross-org actor who is not the owner", async () => {
    const { deps } = await seed();
    const r = await setReportSharing(
      deps,
      { orgId: orgB, userId: otherUser, scopes: ["acl:write"] },
      { slug: slug(SLUG), sharing: "org_edit" },
    );
    expect(!r.ok && r.error.kind).toBe("NotAllowed");
  });
});
