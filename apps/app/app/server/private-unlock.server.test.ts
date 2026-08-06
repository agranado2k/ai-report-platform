// The `/unlock/{slug}` PRIVATE-mode decision. Until the 2026-08-06 owner
// lockout this page 403'd unconditionally, on the stated assumption that an
// owner "reaches it via the dashboard's owner-open, not this page". Both halves
// were false: the raw `view.<domain>/{slug}` link an owner naturally copies
// lands here, and ANY failed edit-token round-trip on the view origin degrades
// to the public viewer, which sends a private report straight here.
import {
  InMemoryIdentityStore,
  InMemoryOrgWriteGrantStore,
  InMemoryReportRepository,
  InMemoryWriteGrantStore,
} from "arp-application/testing";
import {
  createReport,
  folderId,
  makeSlug,
  orgId,
  reportId,
  type Slug,
  userId,
  versionId,
} from "arp-domain";
import { describe, expect, it } from "vitest";
import { decidePrivateUnlock } from "./private-unlock.server";

const ORG = orgId("00000000-0000-7000-8000-0000000000a1");
const OTHER_ORG = orgId("00000000-0000-7000-8000-0000000000b1");
const OWNER = userId("00000000-0000-7000-8000-0000000000d1");
const COLLEAGUE = userId("00000000-0000-7000-8000-0000000000d2");
const GRANTEE = userId("00000000-0000-7000-8000-0000000000d3");
const SLUG = "aaaaaaaaaa";

function slug(s: string): Slug {
  const r = makeSlug(s);
  if (!r.ok) throw new Error("bad slug");
  return r.value;
}

async function fixture() {
  const reports = new InMemoryReportRepository();
  const { report } = createReport({
    id: reportId("00000000-0000-7000-8000-0000000000c1"),
    orgId: ORG,
    folderId: folderId("00000000-0000-7000-8000-0000000000f1"),
    slug: slug(SLUG),
    title: "T",
    versionId: versionId("00000000-0000-7000-8000-0000000000e1"),
    contentHash: "h".repeat(64),
    uploadedBy: OWNER,
    manifest: { entryDocument: "index.html", files: ["index.html"] },
    sizeBytes: 1,
  });
  await reports.save(report);
  const grants = new InMemoryWriteGrantStore();
  const identities = new InMemoryIdentityStore();
  const deps = {
    reports,
    writeGrant: { grants, orgWriteGrants: new InMemoryOrgWriteGrantStore(), identities },
  };
  return { deps, report, grants, identities };
}

describe("decidePrivateUnlock", () => {
  it("THE LOCKOUT FIX: the OWNER is offered their own report's owner-open, not a 403", async () => {
    const { deps } = await fixture();
    expect(
      await decidePrivateUnlock(deps, { actor: { orgId: ORG, userId: OWNER }, slug: slug(SLUG) }),
    ).toEqual({ kind: "offer-owner-open", to: `/reports/${SLUG}/open` });
  });

  it("a write-grantee is offered it too (they can edit — /open admits them identically)", async () => {
    const { deps, report, grants, identities } = await fixture();
    identities.seedUser(GRANTEE, "grantee@x.com");
    await grants.grant(report.id, "grantee@x.com", OWNER, GRANTEE);
    expect(
      await decidePrivateUnlock(deps, { actor: { orgId: ORG, userId: GRANTEE }, slug: slug(SLUG) }),
    ).toEqual({ kind: "offer-owner-open", to: `/reports/${SLUG}/open` });
  });

  // Existence must stay private (ADR-0056): every non-entitled visitor gets the
  // SAME `deny`, so the page can render one byte-identical 403 for "not yours",
  // "not signed in" and "no such report".
  it.each<[string, () => { readonly orgId: typeof ORG; readonly userId: typeof OWNER } | null]>([
    ["a same-org non-owner, non-grantee", () => ({ orgId: ORG, userId: COLLEAGUE })],
    ["a cross-org visitor", () => ({ orgId: OTHER_ORG, userId: COLLEAGUE })],
    ["an anonymous visitor", () => null],
  ])("%s is denied", async (_n, actorOf) => {
    const { deps } = await fixture();
    expect(await decidePrivateUnlock(deps, { actor: actorOf(), slug: slug(SLUG) })).toEqual({
      kind: "deny",
    });
  });

  it("an unknown slug is denied identically (never distinguishable from 'not yours')", async () => {
    const { deps } = await fixture();
    expect(
      await decidePrivateUnlock(deps, {
        actor: { orgId: ORG, userId: OWNER },
        slug: slug("zzzzzzzzzz"),
      }),
    ).toEqual({ kind: "deny" });
  });

  // Loop safety: the way back in is a link the USER activates, never an
  // automatic redirect. /unlock is reached BY a redirect from the viewer, and
  // the viewer can bounce straight back here (e.g. a token this origin mints
  // that the view origin can't validate — the PR #185 secret-misalignment
  // class). An auto-redirect would make that a tight infinite loop where it is
  // currently a terminal 403.
  it("hands back a link to the ONE mint route — never a re-mint of its own", async () => {
    const { deps } = await fixture();
    const decision = await decidePrivateUnlock(deps, {
      actor: { orgId: ORG, userId: OWNER },
      slug: slug(SLUG),
    });
    expect(decision).toMatchObject({
      to: expect.stringMatching(/^\/reports\/[a-zA-Z0-9_-]+\/open$/),
    });
  });
});
