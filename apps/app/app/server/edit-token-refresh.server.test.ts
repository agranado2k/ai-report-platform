// Unit tests for refreshEditToken — the silent-refresh backend (ADR-0063
// Phase 5) behind POST /api/v1/reports/{slug}/edit-token. This is a NEW
// token-minting surface: a caller who already holds SOME canWrite-derived
// actor (in practice, one resolved by resolveEditTokenActor upstream, see
// edit-token-actor.server.test.ts's exhaustive coverage of THAT boundary) is
// handed a FRESH edit token. This module's own job is the belt-and-braces
// re-check — mirrors reassembleAndSaveEditedVersion's documented layering
// (save-edited-version.server.ts): re-run loadWritableReport a SECOND time
// here, regardless of how `actor` got resolved upstream, so a revoked grant
// or lost ownership denies the refresh even if some future front door ever
// reached this helper without its own live check.
import {
  InMemoryIdentityStore,
  InMemoryReportRepository,
  InMemoryWriteGrantStore,
} from "arp-application/testing";
import {
  createReport,
  folderId,
  makeSlug,
  orgId,
  readEditToken,
  reportId,
  type Slug,
  userId,
  versionId,
} from "arp-domain";
import { describe, expect, it } from "vitest";
import { refreshEditToken } from "./edit-token-refresh.server";

const ORG = orgId("00000000-0000-7000-8000-0000000000a1");
const OWNER = userId("00000000-0000-7000-8000-0000000000d1");
const GRANTEE = userId("00000000-0000-7000-8000-0000000000d3");
const OUTSIDER = userId("00000000-0000-7000-8000-0000000000d4");
const SECRET = "test-secret";
const NOW_SECONDS = 1_750_000_000;
const TTL = 900;

function slug(s: string): Slug {
  const r = makeSlug(s);
  if (!r.ok) throw new Error("bad slug");
  return r.value;
}

async function seeded(slugStr: string) {
  const reports = new InMemoryReportRepository();
  const { report } = createReport({
    id: reportId("00000000-0000-7000-8000-0000000000c1"),
    orgId: ORG,
    folderId: folderId("00000000-0000-7000-8000-0000000000f1"),
    slug: slug(slugStr),
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
  return { reports, report, grants, identities };
}

function makeDeps(
  reports: InMemoryReportRepository,
  grants: InMemoryWriteGrantStore,
  identities: InMemoryIdentityStore,
) {
  return {
    reports,
    grants,
    identities,
    secret: SECRET,
    ttlSeconds: TTL,
    nowSeconds: () => NOW_SECONDS,
  };
}

describe("refreshEditToken (ADR-0063 Phase 5 — the silent-refresh backend)", () => {
  it("OWNER: issues a fresh edit token, sub = actor.userId, exp = now + ttl", async () => {
    const { reports, grants, identities } = await seeded("aaaaaaaaaa");
    const result = await refreshEditToken(
      makeDeps(reports, grants, identities),
      { orgId: ORG, userId: OWNER },
      slug("aaaaaaaaaa"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.expiresAt).toBe(NOW_SECONDS + TTL);
    const claims = readEditToken(result.value.editToken, "aaaaaaaaaa", SECRET, NOW_SECONDS);
    expect(claims).toMatchObject({
      slug: "aaaaaaaaaa",
      sub: OWNER,
      scope: "edit",
      exp: NOW_SECONDS + TTL,
    });
  });

  it("GRANTEE: issues a fresh edit token, sub = the grantee (not echoed from any old token)", async () => {
    const { reports, report, grants, identities } = await seeded("bbbbbbbbbb");
    identities.seedUser(GRANTEE, "grantee@x.com");
    await grants.grant(report.id, "grantee@x.com", OWNER, GRANTEE);

    const result = await refreshEditToken(
      makeDeps(reports, grants, identities),
      { orgId: ORG, userId: GRANTEE },
      slug("bbbbbbbbbb"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const claims = readEditToken(result.value.editToken, "bbbbbbbbbb", SECRET, NOW_SECONDS);
    expect(claims?.sub).toBe(GRANTEE);
  });

  it("DENIED — revoked-canWrite: a grantee whose grant was revoked gets NO fresh token", async () => {
    const { reports, report, grants, identities } = await seeded("cccccccccc");
    identities.seedUser(GRANTEE, "grantee@x.com");
    await grants.grant(report.id, "grantee@x.com", OWNER, GRANTEE);
    await grants.revoke(report.id, "grantee@x.com"); // revoked AFTER the (hypothetical) original mint

    const result = await refreshEditToken(
      makeDeps(reports, grants, identities),
      { orgId: ORG, userId: GRANTEE },
      slug("cccccccccc"),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("NotAllowed");
  });

  it("DENIED — never had canWrite: an outsider gets NO token", async () => {
    const { reports, grants, identities } = await seeded("dddddddddd");
    const result = await refreshEditToken(
      makeDeps(reports, grants, identities),
      { orgId: ORG, userId: OUTSIDER },
      slug("dddddddddd"),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("NotAllowed");
  });

  it("DENIED — lost ownership: the report was transferred, the old owner's refresh is denied", async () => {
    const { reports, report, grants, identities } = await seeded("eeeeeeeeee");
    // Transfer ownership away from OWNER.
    await reports.save({ ...report, ownerId: GRANTEE });

    const result = await refreshEditToken(
      makeDeps(reports, grants, identities),
      { orgId: ORG, userId: OWNER },
      slug("eeeeeeeeee"),
    );
    expect(result.ok).toBe(false);
  });

  it("DENIED — the report was soft-deleted since the original mint", async () => {
    const { reports, report, grants, identities } = await seeded("ffffffffff");
    await reports.save({ ...report, deletedAt: NOW_SECONDS * 1000 });

    const result = await refreshEditToken(
      makeDeps(reports, grants, identities),
      { orgId: ORG, userId: OWNER },
      slug("ffffffffff"),
    );
    expect(result.ok).toBe(false);
  });

  it("DENIED — the report doesn't exist at all", async () => {
    const reports = new InMemoryReportRepository();
    const result = await refreshEditToken(
      makeDeps(reports, new InMemoryWriteGrantStore(), new InMemoryIdentityStore()),
      { orgId: ORG, userId: OWNER },
      slug("gggggggggg"),
    );
    expect(result.ok).toBe(false);
  });

  it("each refresh is minted fresh — two successive refreshes for the same actor yield DIFFERENT tokens with later expiries", async () => {
    const { reports, grants, identities } = await seeded("hhhhhhhhhh");
    const first = await refreshEditToken(
      { ...makeDeps(reports, grants, identities), nowSeconds: () => NOW_SECONDS },
      { orgId: ORG, userId: OWNER },
      slug("hhhhhhhhhh"),
    );
    const second = await refreshEditToken(
      { ...makeDeps(reports, grants, identities), nowSeconds: () => NOW_SECONDS + 60 },
      { orgId: ORG, userId: OWNER },
      slug("hhhhhhhhhh"),
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.editToken).not.toBe(second.value.editToken);
    expect(second.value.expiresAt).toBeGreaterThan(first.value.expiresAt);
  });
});
