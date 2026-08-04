// Adversarial unit tests for the edit-token ACCEPTANCE seam (ADR-0063) — the
// trust-boundary counterpart to open-report.server.test.ts's mint coverage.
// This is THE function that decides whether a bearer token off the wire gets
// to act as a real user on a real report: every failure mode below MUST
// collapse to `null` (fail-closed), and the one success path MUST re-check
// canWrite LIVE, not just trust the token's signature.
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
  mintAccessToken,
  mintEditToken,
  orgId,
  reportId,
  type Slug,
  userId,
  versionId,
} from "arp-domain";
import { describe, expect, it } from "vitest";
import { resolveEditTokenActor } from "./edit-token-actor.server";

const ORG = orgId("00000000-0000-7000-8000-0000000000a1");
const OWNER = userId("00000000-0000-7000-8000-0000000000d1");
const GRANTEE = userId("00000000-0000-7000-8000-0000000000d3");
const OUTSIDER = userId("00000000-0000-7000-8000-0000000000d4");
const SECRET = "test-secret";
const OTHER_SECRET = "wrong-secret";
const NOW = 1_750_000_000_000; // ms
const NOW_SECONDS = Math.floor(NOW / 1000);

function slug(s: string): Slug {
  const r = makeSlug(s);
  if (!r.ok) throw new Error("bad slug");
  return r.value;
}

function bearerRequest(token: string | null | undefined): Request {
  const headers = new Headers();
  if (token !== null && token !== undefined) headers.set("authorization", `Bearer ${token}`);
  return new Request("https://app.example.com/reports/x/edit", { headers });
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
  secret: string | undefined = SECRET,
) {
  return {
    reports,
    writeGrant: { grants, identities, orgWriteGrants: new InMemoryOrgWriteGrantStore() },
    secret,
    nowSeconds: () => NOW_SECONDS,
  } as const;
}

const OTHER_ORG = orgId("00000000-0000-7000-8000-0000000000a2");

describe("resolveEditTokenActor — the org-write leg is org-BOUND (ADR-0078 §1)", () => {
  // The hazard: `candidate.orgId` used to be read off the REPORT, so
  // `hasOrgWriteGrant`'s `report.orgId !== actor.orgId` guard could never be
  // false on this door. Any holder of a valid edit token was, by construction,
  // "in the report's org" — including a CROSS-ORG personal write grantee
  // (ADR-0060 §4 makes those work cross-org by design), who would ride the
  // org-write leg after their own personal grant was revoked.
  //
  // The org is now a CLAIM stamped at mint from the verified Clerk session, so
  // the guard compares two independent facts again.
  it("a cross-org token does NOT ride the org-write leg once its personal grant is gone", async () => {
    const { reports, report, grants, identities } = await seeded("orgorg0001");
    const deps = makeDeps(reports, grants, identities);
    // The report carries an org-write row for ITS org.
    await deps.writeGrant.orgWriteGrants.grant(report.id, ORG, OWNER);
    identities.seedUser(OUTSIDER, "outsider@elsewhere.com");
    // Minted while the user was acting in a DIFFERENT org — no personal grant.
    const token = mintEditToken(
      "orgorg0001",
      OUTSIDER,
      900,
      SECRET,
      NOW_SECONDS,
      NOW_SECONDS,
      OTHER_ORG,
    );

    expect(await resolveEditTokenActor(bearerRequest(token), "orgorg0001", deps)).toBeNull();
  });

  it("a same-org token DOES ride the org-write leg — the feature still works", async () => {
    const { reports, report, grants, identities } = await seeded("orgorg0002");
    const deps = makeDeps(reports, grants, identities);
    await deps.writeGrant.orgWriteGrants.grant(report.id, ORG, OWNER);
    identities.seedUser(OUTSIDER, "colleague@x.com");
    const token = mintEditToken("orgorg0002", OUTSIDER, 900, SECRET, NOW_SECONDS, NOW_SECONDS, ORG);

    const actor = await resolveEditTokenActor(bearerRequest(token), "orgorg0002", deps);
    expect(actor?.userId).toBe(OUTSIDER);
  });

  it("a cross-org token still works through its own PERSONAL grant (ADR-0060 §4)", async () => {
    // The deliberate asymmetry: a personal write grant is cross-org BY DESIGN.
    // Binding the org must not break it.
    const { reports, report, grants, identities } = await seeded("orgorg0003");
    const deps = makeDeps(reports, grants, identities);
    identities.seedUser(OUTSIDER, "outsider@elsewhere.com");
    await grants.grant(report.id, "outsider@elsewhere.com", OWNER, OUTSIDER);
    const token = mintEditToken(
      "orgorg0003",
      OUTSIDER,
      900,
      SECRET,
      NOW_SECONDS,
      NOW_SECONDS,
      OTHER_ORG,
    );

    const actor = await resolveEditTokenActor(bearerRequest(token), "orgorg0003", deps);
    expect(actor?.userId).toBe(OUTSIDER);
  });

  it("a LEGACY token with no org claim keeps today's behavior on the org-write leg", async () => {
    // Backward compat for the ≤15-min window after a deploy: an unstamped token
    // falls back to the report's org, exactly as before. Documented rather than
    // silently fail-closed, which would break every in-flight editor.
    const { reports, report, grants, identities } = await seeded("orgorg0004");
    const deps = makeDeps(reports, grants, identities);
    await deps.writeGrant.orgWriteGrants.grant(report.id, ORG, OWNER);
    identities.seedUser(OUTSIDER, "colleague@x.com");
    const token = mintEditToken("orgorg0004", OUTSIDER, 900, SECRET, NOW_SECONDS);

    const actor = await resolveEditTokenActor(bearerRequest(token), "orgorg0004", deps);
    expect(actor?.userId).toBe(OUTSIDER);
  });
});

describe("resolveEditTokenActor (ADR-0063 — the edit-token trust boundary)", () => {
  it("VALID: a write-grantee's edit token resolves to their actor, with the report's real folderId", async () => {
    const { reports, report, grants, identities } = await seeded("aaaaaaaaaa");
    identities.seedUser(GRANTEE, "grantee@x.com");
    await grants.grant(report.id, "grantee@x.com", OWNER, GRANTEE);
    const token = mintEditToken("aaaaaaaaaa", GRANTEE, 900, SECRET, NOW_SECONDS);

    const actor = await resolveEditTokenActor(
      bearerRequest(token),
      "aaaaaaaaaa",
      makeDeps(reports, grants, identities),
    );

    expect(actor).toEqual({ orgId: ORG, userId: GRANTEE, folderId: report.folderId });
  });

  it("VALID: the owner's OWN edit token (e.g. minted defensively) still resolves — owner is canWrite too", async () => {
    const { reports, report, grants, identities } = await seeded("bbbbbbbbbb");
    const token = mintEditToken("bbbbbbbbbb", OWNER, 900, SECRET, NOW_SECONDS);

    const actor = await resolveEditTokenActor(
      bearerRequest(token),
      "bbbbbbbbbb",
      makeDeps(reports, grants, identities),
    );

    expect(actor).toEqual({ orgId: ORG, userId: OWNER, folderId: report.folderId });
  });

  it("REJECT: no Authorization header at all — falls through, doesn't throw", async () => {
    const { reports, grants, identities } = await seeded("cccccccccc");
    const actor = await resolveEditTokenActor(
      bearerRequest(undefined),
      "cccccccccc",
      makeDeps(reports, grants, identities),
    );
    expect(actor).toBeNull();
  });

  it("REJECT: a blank Bearer value", async () => {
    const { reports, grants, identities } = await seeded("dddddddddd");
    const actor = await resolveEditTokenActor(
      bearerRequest(""),
      "dddddddddd",
      makeDeps(reports, grants, identities),
    );
    expect(actor).toBeNull();
  });

  it("REJECT: a non-Bearer Authorization scheme", async () => {
    const { reports, grants, identities } = await seeded("eeeeeeeeee");
    const headers = new Headers({ authorization: "Basic dXNlcjpwYXNz" });
    const request = new Request("https://app.example.com/reports/eeeeeeeeee/edit", { headers });
    const actor = await resolveEditTokenActor(
      request,
      "eeeeeeeeee",
      makeDeps(reports, grants, identities),
    );
    expect(actor).toBeNull();
  });

  it("REJECT: wrong-slug token — minted for report A, presented against report B", async () => {
    // Two reports in the SAME repository, so the wrong-slug rejection isn't
    // masked by "report not found".
    const reports = new InMemoryReportRepository();
    const { report: rA } = createReport({
      id: reportId("00000000-0000-7000-8000-0000000000c1"),
      orgId: ORG,
      folderId: folderId("00000000-0000-7000-8000-0000000000f1"),
      slug: slug("ffffffffff"),
      title: "A",
      versionId: versionId("00000000-0000-7000-8000-0000000000e1"),
      contentHash: "h".repeat(64),
      uploadedBy: OWNER,
      manifest: { entryDocument: "index.html", files: ["index.html"] },
      sizeBytes: 1,
    });
    const { report: rB } = createReport({
      id: reportId("00000000-0000-7000-8000-0000000000c2"),
      orgId: ORG,
      folderId: folderId("00000000-0000-7000-8000-0000000000f1"),
      slug: slug("gggggggggg"),
      title: "B",
      versionId: versionId("00000000-0000-7000-8000-0000000000e2"),
      contentHash: "h".repeat(64),
      uploadedBy: OWNER,
      manifest: { entryDocument: "index.html", files: ["index.html"] },
      sizeBytes: 1,
    });
    await reports.save(rA);
    await reports.save(rB);

    // Token minted for report A's slug...
    const token = mintEditToken("ffffffffff", OWNER, 900, SECRET, NOW_SECONDS);
    // ...presented against report B's slug.
    const actor = await resolveEditTokenActor(
      bearerRequest(token),
      "gggggggggg",
      makeDeps(reports, new InMemoryWriteGrantStore(), new InMemoryIdentityStore()),
    );
    expect(actor).toBeNull();
  });

  it("REJECT: an expired token", async () => {
    const { reports, grants, identities } = await seeded("hhhhhhhhhh");
    const token = mintEditToken("hhhhhhhhhh", OWNER, 900, SECRET, NOW_SECONDS - 1000); // expired 100s ago
    const actor = await resolveEditTokenActor(
      bearerRequest(token),
      "hhhhhhhhhh",
      makeDeps(reports, grants, identities),
    );
    expect(actor).toBeNull();
  });

  it("REJECT: a tampered signature", async () => {
    const { reports, grants, identities } = await seeded("iiiiiiiiii");
    const token = mintEditToken("iiiiiiiiii", OWNER, 900, SECRET, NOW_SECONDS);
    const dot = token.indexOf(".");
    const tampered = `${token.slice(0, dot)}.${token
      .slice(dot + 1)
      .split("")
      .reverse()
      .join("")}`;
    const actor = await resolveEditTokenActor(
      bearerRequest(tampered),
      "iiiiiiiiii",
      makeDeps(reports, grants, identities),
    );
    expect(actor).toBeNull();
  });

  it("REJECT: signed under a DIFFERENT secret", async () => {
    const { reports, grants, identities } = await seeded("jjjjjjjjjj");
    const token = mintEditToken("jjjjjjjjjj", OWNER, 900, OTHER_SECRET, NOW_SECONDS);
    const actor = await resolveEditTokenActor(
      bearerRequest(token),
      "jjjjjjjjjj",
      makeDeps(reports, grants, identities),
    );
    expect(actor).toBeNull();
  });

  it("REJECT — CROSS-PARSE GUARD: an owner ACCESS token (same secret, owner:true) presented as an edit token", async () => {
    const { reports, grants, identities } = await seeded("kkkkkkkkkk");
    // Minted by the OWNER path (open-report.server.ts) under the SAME shared
    // secret — a completely different, unrelated capability shape (no
    // scope/sub fields at all). The `scope==="edit"` discriminant in
    // edit-token.ts's parseEditClaims is what must stop this.
    const accessToken = mintAccessToken("kkkkkkkkkk", 86_400, SECRET, NOW_SECONDS, { owner: true });
    const actor = await resolveEditTokenActor(
      bearerRequest(accessToken),
      "kkkkkkkkkk",
      makeDeps(reports, grants, identities),
    );
    expect(actor).toBeNull();
  });

  it("REJECT: canWrite was REVOKED after the token was minted (the live re-check, not just signature)", async () => {
    const { reports, report, grants, identities } = await seeded("llllllllll");
    identities.seedUser(GRANTEE, "grantee@x.com");
    await grants.grant(report.id, "grantee@x.com", OWNER, GRANTEE);
    const token = mintEditToken("llllllllll", GRANTEE, 900, SECRET, NOW_SECONDS);

    // Revoke AFTER minting — the token's signature is still perfectly valid.
    await grants.revoke(report.id, "grantee@x.com");

    const actor = await resolveEditTokenActor(
      bearerRequest(token),
      "llllllllll",
      makeDeps(reports, grants, identities),
    );
    expect(actor).toBeNull();
  });

  it("REJECT: a user with NO write grant at all (never had canWrite)", async () => {
    const { reports, grants, identities } = await seeded("mmmmmmmmmm");
    const token = mintEditToken("mmmmmmmmmm", OUTSIDER, 900, SECRET, NOW_SECONDS);
    const actor = await resolveEditTokenActor(
      bearerRequest(token),
      "mmmmmmmmmm",
      makeDeps(reports, grants, identities),
    );
    expect(actor).toBeNull();
  });

  it("REJECT: the report was soft-deleted after the token was minted", async () => {
    const { reports, report, grants, identities } = await seeded("nnnnnnnnnn");
    const token = mintEditToken("nnnnnnnnnn", OWNER, 900, SECRET, NOW_SECONDS);
    await reports.save({ ...report, deletedAt: NOW });

    const actor = await resolveEditTokenActor(
      bearerRequest(token),
      "nnnnnnnnnn",
      makeDeps(reports, grants, identities),
    );
    expect(actor).toBeNull();
  });

  it("REJECT: the report doesn't exist at all", async () => {
    const reports = new InMemoryReportRepository();
    const token = mintEditToken("oooooooooo", OWNER, 900, SECRET, NOW_SECONDS);
    const actor = await resolveEditTokenActor(
      bearerRequest(token),
      "oooooooooo",
      makeDeps(reports, new InMemoryWriteGrantStore(), new InMemoryIdentityStore()),
    );
    expect(actor).toBeNull();
  });

  it("REJECT: no secret configured (previews/dev) — never trust any token", async () => {
    const { reports, grants, identities } = await seeded("pppppppppp");
    const token = mintEditToken("pppppppppp", OWNER, 900, SECRET, NOW_SECONDS);
    const actor = await resolveEditTokenActor(bearerRequest(token), "pppppppppp", {
      reports,
      writeGrant: { grants, identities, orgWriteGrants: new InMemoryOrgWriteGrantStore() },
      secret: undefined, // explicitly undefined — not routed through makeDeps's default param
      nowSeconds: () => NOW_SECONDS,
    });
    expect(actor).toBeNull();
  });

  it("REJECT: a malformed route slug (can't even parse) — never reaches the DB", async () => {
    const { reports, grants, identities } = await seeded("qqqqqqqqqq");
    const token = mintEditToken("qqqqqqqqqq", OWNER, 900, SECRET, NOW_SECONDS);
    const actor = await resolveEditTokenActor(
      bearerRequest(token),
      "!!not-a-slug!!",
      makeDeps(reports, grants, identities),
    );
    expect(actor).toBeNull();
  });

  it("REJECT: garbage bearer text that isn't a token at all", async () => {
    const { reports, grants, identities } = await seeded("rrrrrrrrrr");
    const actor = await resolveEditTokenActor(
      bearerRequest("not-a-real-token"),
      "rrrrrrrrrr",
      makeDeps(reports, grants, identities),
    );
    expect(actor).toBeNull();
  });
});
