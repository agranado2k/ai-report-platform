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
import { createHmac } from "node:crypto";
import {
  InMemoryIdentityStore,
  InMemoryReportRepository,
  InMemoryWriteGrantStore,
} from "arp-application/testing";
import {
  createReport,
  folderId,
  makeSlug,
  mintEditToken,
  orgId,
  readEditToken,
  reportId,
  type Slug,
  userId,
  versionId,
} from "arp-domain";
import { describe, expect, it } from "vitest";
import {
  type PresentedSession,
  refreshEditToken,
  resolvePresentedSession,
  SESSION_CAP_SECONDS,
} from "./edit-token-refresh.server";

/** Most tests here are about the canWrite re-check, not the session cap — a
 *  fresh session (as if `actor` were resolved via a non-edit-token front
 *  door) is the neutral choice that never itself denies. */
const FRESH_SESSION: PresentedSession = { kind: "no-edit-token" };

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
      FRESH_SESSION,
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
      FRESH_SESSION,
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
      FRESH_SESSION,
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
      FRESH_SESSION,
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
      FRESH_SESSION,
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
      FRESH_SESSION,
    );
    expect(result.ok).toBe(false);
  });

  it("DENIED — the report doesn't exist at all", async () => {
    const reports = new InMemoryReportRepository();
    const result = await refreshEditToken(
      makeDeps(reports, new InMemoryWriteGrantStore(), new InMemoryIdentityStore()),
      { orgId: ORG, userId: OWNER },
      slug("gggggggggg"),
      FRESH_SESSION,
    );
    expect(result.ok).toBe(false);
  });

  it("each refresh is minted fresh — two successive refreshes for the same actor yield DIFFERENT tokens with later expiries", async () => {
    const { reports, grants, identities } = await seeded("hhhhhhhhhh");
    const first = await refreshEditToken(
      { ...makeDeps(reports, grants, identities), nowSeconds: () => NOW_SECONDS },
      { orgId: ORG, userId: OWNER },
      slug("hhhhhhhhhh"),
      FRESH_SESSION,
    );
    const second = await refreshEditToken(
      { ...makeDeps(reports, grants, identities), nowSeconds: () => NOW_SECONDS + 60 },
      { orgId: ORG, userId: OWNER },
      slug("hhhhhhhhhh"),
      FRESH_SESSION,
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.editToken).not.toBe(second.value.editToken);
    expect(second.value.expiresAt).toBeGreaterThan(first.value.expiresAt);
  });
});

describe("refreshEditToken — the ABSOLUTE session cap (ADR-0063 amendment)", () => {
  it("no-edit-token (fresh session): a caller with NO presented edit token gets a token whose sessionStart = now", async () => {
    const { reports, grants, identities } = await seeded("iiiiiiiiii");
    const result = await refreshEditToken(
      makeDeps(reports, grants, identities),
      { orgId: ORG, userId: OWNER },
      slug("iiiiiiiiii"),
      { kind: "no-edit-token" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const claims = readEditToken(result.value.editToken, "iiiiiiiiii", SECRET, NOW_SECONDS);
    expect(claims?.sessionStart).toBe(NOW_SECONDS);
  });

  it("WITHIN the cap: refresh succeeds AND the new token carries the SAME sessionStart forward (not reset)", async () => {
    const { reports, grants, identities } = await seeded("jjjjjjjjjj");
    const originalSessionStart = NOW_SECONDS - (SESSION_CAP_SECONDS - 60); // 60s inside the cap
    const result = await refreshEditToken(
      makeDeps(reports, grants, identities),
      { orgId: ORG, userId: OWNER },
      slug("jjjjjjjjjj"),
      { kind: "edit-token", sessionStart: originalSessionStart },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const claims = readEditToken(result.value.editToken, "jjjjjjjjjj", SECRET, NOW_SECONDS);
    // Carried forward UNCHANGED — NOT reset to NOW_SECONDS.
    expect(claims?.sessionStart).toBe(originalSessionStart);
    expect(claims?.sessionStart).not.toBe(NOW_SECONDS);
    // exp still anchors on THIS refresh's now, same as any other refresh.
    expect(result.value.expiresAt).toBe(NOW_SECONDS + TTL);
  });

  it("AT the cap boundary (now - sessionStart === SESSION_CAP_SECONDS): denied", async () => {
    const { reports, grants, identities } = await seeded("kkkkkkkkkk");
    const result = await refreshEditToken(
      makeDeps(reports, grants, identities),
      { orgId: ORG, userId: OWNER },
      slug("kkkkkkkkkk"),
      { kind: "edit-token", sessionStart: NOW_SECONDS - SESSION_CAP_SECONDS },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("NotAllowed");
  });

  it("PAST the cap: denied even though canWrite still holds (this is the whole point — a never-revoked grant still expires the session)", async () => {
    const { reports, grants, identities } = await seeded("llllllllll");
    const result = await refreshEditToken(
      makeDeps(reports, grants, identities),
      { orgId: ORG, userId: OWNER }, // OWNER — never revoked, canWrite holds forever
      slug("llllllllll"),
      { kind: "edit-token", sessionStart: NOW_SECONDS - SESSION_CAP_SECONDS - 1 },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("NotAllowed");
  });

  it("a presented edit token with NO sessionStart (legacy, pre-cap) is DENIED — fail closed on unknown age", async () => {
    const { reports, grants, identities } = await seeded("mmmmmmmmmm");
    const result = await refreshEditToken(
      makeDeps(reports, grants, identities),
      { orgId: ORG, userId: OWNER },
      slug("mmmmmmmmmm"),
      { kind: "edit-token", sessionStart: undefined },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("NotAllowed");
  });

  it("the live-canWrite deny (revoked grant) still denies even with a fresh, well-within-cap session", async () => {
    const { reports, report, grants, identities } = await seeded("nnnnnnnnnn");
    identities.seedUser(GRANTEE, "grantee@x.com");
    await grants.grant(report.id, "grantee@x.com", OWNER, GRANTEE);
    await grants.revoke(report.id, "grantee@x.com");

    const result = await refreshEditToken(
      makeDeps(reports, grants, identities),
      { orgId: ORG, userId: GRANTEE },
      slug("nnnnnnnnnn"),
      { kind: "edit-token", sessionStart: NOW_SECONDS - 60 }, // well within the cap
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("NotAllowed");
  });
});

describe("resolvePresentedSession", () => {
  function requestWithBearer(token?: string): Request {
    return new Request("https://app.example/api/v1/reports/oooooooooo/edit-token", {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  }

  it("a currently-valid presented edit token resolves kind:'edit-token' with its sessionStart", () => {
    const originalSessionStart = NOW_SECONDS - 3600; // an hour into an existing session
    const token = mintEditToken(
      "oooooooooo",
      OWNER,
      TTL,
      SECRET,
      NOW_SECONDS, // this hop's own mint time — still unexpired
      originalSessionStart, // carried forward from the original mint
    );
    const presented = resolvePresentedSession(
      requestWithBearer(token),
      slug("oooooooooo"),
      SECRET,
      NOW_SECONDS,
    );
    expect(presented).toEqual({ kind: "edit-token", sessionStart: originalSessionStart });
  });

  it("no Authorization header at all resolves kind:'no-edit-token'", () => {
    const presented = resolvePresentedSession(
      requestWithBearer(),
      slug("oooooooooo"),
      SECRET,
      NOW_SECONDS,
    );
    expect(presented).toEqual({ kind: "no-edit-token" });
  });

  it("a token that fails to verify (wrong secret) resolves kind:'no-edit-token' — no chain to bound", () => {
    const token = mintEditToken("oooooooooo", OWNER, TTL, "wrong-secret", NOW_SECONDS);
    const presented = resolvePresentedSession(
      requestWithBearer(token),
      slug("oooooooooo"),
      SECRET,
      NOW_SECONDS,
    );
    expect(presented).toEqual({ kind: "no-edit-token" });
  });

  it("an expired presented edit token resolves kind:'no-edit-token'", () => {
    const token = mintEditToken("oooooooooo", OWNER, TTL, SECRET, NOW_SECONDS - TTL - 1);
    const presented = resolvePresentedSession(
      requestWithBearer(token),
      slug("oooooooooo"),
      SECRET,
      NOW_SECONDS,
    );
    expect(presented).toEqual({ kind: "no-edit-token" });
  });

  it("a legacy presented edit token (no sessionStart claim) resolves kind:'edit-token' with sessionStart undefined", () => {
    // Hand-build a legacy payload (no sessionStart field) rather than mint one,
    // since mintEditToken always sets it going forward.
    const payload = Buffer.from(
      JSON.stringify({ slug: "oooooooooo", exp: NOW_SECONDS + TTL, sub: OWNER, scope: "edit" }),
      "utf8",
    ).toString("base64url");
    const sig = createHmac("sha256", SECRET).update(payload).digest("base64url");
    const legacyToken = `${payload}.${sig}`;

    const presented = resolvePresentedSession(
      requestWithBearer(legacyToken),
      slug("oooooooooo"),
      SECRET,
      NOW_SECONDS,
    );
    expect(presented).toEqual({ kind: "edit-token", sessionStart: undefined });
  });
});
