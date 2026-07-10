// Unit tests for the owner-open decision — the ADR-0059 §4 security keystone —
// PLUS the edit-token mint (ADR-0063): a canWrite (owner OR write-grantee) user
// who is NOT the owner is minted a short-lived, slug-bound `scope:"edit"`
// token instead of the owner's 24h `owner:true` access token. The owner path
// MUST stay unaffected — an owner is trivially canWrite too, so the ownership
// gate is checked FIRST and short-circuits before the edit-token branch is
// ever reached.
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
  readAccessToken,
  readEditToken,
  reportId,
  type Slug,
  userId,
  versionId,
} from "arp-domain";
import { describe, expect, it } from "vitest";
import { EDIT_TTL_SECONDS, OWNER_TTL_SECONDS, ownerOpenLocation } from "./open-report.server";

const ORG = orgId("00000000-0000-7000-8000-0000000000a1");
const OWNER = userId("00000000-0000-7000-8000-0000000000d1");
const COLLEAGUE = userId("00000000-0000-7000-8000-0000000000d2");
const GRANTEE = userId("00000000-0000-7000-8000-0000000000d3");
const SECRET = "test-secret";
const VIEW = "https://view.example.com";
const NOW = 1_750_000_000_000;

function slug(s: string): Slug {
  const r = makeSlug(s);
  if (!r.ok) throw new Error("bad slug");
  return r.value;
}

async function seededReports(slugStr: string) {
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
  return { reports, report };
}

function makeDeps(
  reports: InMemoryReportRepository,
  writeGrant: {
    readonly grants: InMemoryWriteGrantStore;
    readonly identities: InMemoryIdentityStore;
  } = {
    grants: new InMemoryWriteGrantStore(),
    identities: new InMemoryIdentityStore(),
  },
) {
  const logged: unknown[] = [];
  return {
    deps: {
      reports,
      now: () => NOW,
      log: (fields: Record<string, unknown>, msg: string) => logged.push({ fields, msg }),
      writeGrant,
    },
    logged,
  };
}

describe("ownerOpenLocation (ADR-0059 §4 — the owner-token mint gate)", () => {
  it("mints an owner:true token for the OWNER and redirects to the viewer", async () => {
    const { reports } = await seededReports("aaaaaaaaaa");
    const { deps, logged } = makeDeps(reports);
    const location = await ownerOpenLocation(deps, {
      actor: { orgId: ORG, userId: OWNER },
      rawHandle: "aaaaaaaaaa",
      viewOrigin: VIEW,
      secret: SECRET,
    });
    expect(location.startsWith(`${VIEW}/aaaaaaaaaa?access=`)).toBe(true);
    const token = decodeURIComponent(location.split("?access=")[1] ?? "");
    const claims = readAccessToken(token, "aaaaaaaaaa", SECRET, Math.floor(NOW / 1000));
    expect(claims).toMatchObject({ slug: "aaaaaaaaaa", owner: true });
    expect(logged).toHaveLength(1); // the privileged mint is audited
  });

  it("KEYSTONE: a same-org non-owner is bounced to the dashboard — no token", async () => {
    const { reports } = await seededReports("bbbbbbbbbb");
    const { deps, logged } = makeDeps(reports);
    const location = await ownerOpenLocation(deps, {
      actor: { orgId: ORG, userId: COLLEAGUE }, // same org, NOT the owner
      rawHandle: "bbbbbbbbbb",
      viewOrigin: VIEW,
      secret: SECRET,
    });
    expect(location).toBe("/");
    expect(logged).toHaveLength(0);
  });

  it("bounces an unauthenticated request to the dashboard", async () => {
    const { reports } = await seededReports("cccccccccc");
    const { deps } = makeDeps(reports);
    const location = await ownerOpenLocation(deps, {
      actor: null,
      rawHandle: "cccccccccc",
      viewOrigin: VIEW,
      secret: SECRET,
    });
    expect(location).toBe("/");
  });

  it("bounces an unknown handle to the dashboard (never reveals existence)", async () => {
    const reports = new InMemoryReportRepository();
    const { deps } = makeDeps(reports);
    const location = await ownerOpenLocation(deps, {
      actor: { orgId: ORG, userId: OWNER },
      rawHandle: "!!invalid!!",
      viewOrigin: VIEW,
      secret: SECRET,
    });
    expect(location).toBe("/");
  });

  it("falls through to the gated viewer when no secret is configured (previews/dev)", async () => {
    const { reports } = await seededReports("dddddddddd");
    const { deps, logged } = makeDeps(reports);
    const location = await ownerOpenLocation(deps, {
      actor: { orgId: ORG, userId: OWNER },
      rawHandle: "dddddddddd",
      viewOrigin: VIEW,
      secret: undefined,
    });
    expect(location).toBe(`${VIEW}/dddddddddd`);
    expect(logged).toHaveLength(0);
  });

  it("the no-secret fall-through is still owner-gated — a non-owner can't resolve a slug", async () => {
    const { reports } = await seededReports("dddddddddd");
    const { deps } = makeDeps(reports);
    const location = await ownerOpenLocation(deps, {
      actor: { orgId: ORG, userId: COLLEAGUE },
      rawHandle: "dddddddddd",
      viewOrigin: VIEW,
      secret: undefined,
    });
    // The ownership gate runs BEFORE the no-secret branch (review #146): without
    // it, any authenticated user could turn a report_… id into its capability
    // slug via the redirect Location — for public mode the slug IS the capability.
    expect(location).toBe("/");
  });

  it("the minted token expires after 24h", async () => {
    const { reports } = await seededReports("eeeeeeeeee");
    const { deps } = makeDeps(reports);
    const location = await ownerOpenLocation(deps, {
      actor: { orgId: ORG, userId: OWNER },
      rawHandle: "eeeeeeeeee",
      viewOrigin: VIEW,
      secret: SECRET,
    });
    const token = decodeURIComponent(location.split("?access=")[1] ?? "");
    const nowSeconds = Math.floor(NOW / 1000);
    expect(
      readAccessToken(token, "eeeeeeeeee", SECRET, nowSeconds + OWNER_TTL_SECONDS - 1),
    ).not.toBeNull();
    expect(
      readAccessToken(token, "eeeeeeeeee", SECRET, nowSeconds + OWNER_TTL_SECONDS + 1),
    ).toBeNull();
  });
});

describe("ownerOpenLocation — edit-token mint for a canWrite non-owner (ADR-0063)", () => {
  it("mints a scope:edit token for a write-grantee and redirects to the edit route", async () => {
    const { reports, report } = await seededReports("ffffffffff");
    const grants = new InMemoryWriteGrantStore();
    const identities = new InMemoryIdentityStore();
    identities.seedUser(GRANTEE, "grantee@x.com");
    await grants.grant(report.id, "grantee@x.com", OWNER, GRANTEE);
    const { deps, logged } = makeDeps(reports, { grants, identities });

    const location = await ownerOpenLocation(deps, {
      actor: { orgId: ORG, userId: GRANTEE },
      rawHandle: "ffffffffff",
      viewOrigin: VIEW,
      secret: SECRET,
    });

    expect(location.startsWith(`${VIEW}/ffffffffff/edit?et=`)).toBe(true);
    const token = decodeURIComponent(location.split("?et=")[1] ?? "");
    const nowSeconds = Math.floor(NOW / 1000);
    const claims = readEditToken(token, "ffffffffff", SECRET, nowSeconds);
    expect(claims).toMatchObject({
      slug: "ffffffffff",
      sub: GRANTEE,
      scope: "edit",
      exp: nowSeconds + EDIT_TTL_SECONDS,
    });
    expect(logged).toHaveLength(1); // the mint is audited, same as the owner path
  });

  it("owner-but-also-canWrite: the OWNER still gets the owner access token, not an edit token", async () => {
    const { reports, report } = await seededReports("gggggggggg");
    const grants = new InMemoryWriteGrantStore();
    const identities = new InMemoryIdentityStore();
    // The owner also (redundantly) holds a write grant on their own report —
    // ownership must win; the two capabilities are not layered.
    identities.seedUser(OWNER, "owner@x.com");
    await grants.grant(report.id, "owner@x.com", OWNER, OWNER);
    const { deps, logged } = makeDeps(reports, { grants, identities });

    const location = await ownerOpenLocation(deps, {
      actor: { orgId: ORG, userId: OWNER },
      rawHandle: "gggggggggg",
      viewOrigin: VIEW,
      secret: SECRET,
    });

    expect(location.startsWith(`${VIEW}/gggggggggg?access=`)).toBe(true);
    expect(location).not.toContain("/edit?et=");
    expect(logged).toHaveLength(1);
  });

  it("a non-canWrite, non-owner user gets NO token at all (falls to dashboard)", async () => {
    const { reports } = await seededReports("hhhhhhhhhh");
    // COLLEAGUE has no write grant — same org, but neither owner nor grantee.
    const { deps, logged } = makeDeps(reports);
    const location = await ownerOpenLocation(deps, {
      actor: { orgId: ORG, userId: COLLEAGUE },
      rawHandle: "hhhhhhhhhh",
      viewOrigin: VIEW,
      secret: SECRET,
    });
    expect(location).toBe("/");
    expect(logged).toHaveLength(0);
  });

  it("secret unset: a write-grantee canWrite user still falls through unchanged — no edit token", async () => {
    const { reports, report } = await seededReports("iiiiiiiiii");
    const grants = new InMemoryWriteGrantStore();
    const identities = new InMemoryIdentityStore();
    identities.seedUser(GRANTEE, "grantee@x.com");
    await grants.grant(report.id, "grantee@x.com", OWNER, GRANTEE);
    const { deps, logged } = makeDeps(reports, { grants, identities });

    const location = await ownerOpenLocation(deps, {
      actor: { orgId: ORG, userId: GRANTEE },
      rawHandle: "iiiiiiiiii",
      viewOrigin: VIEW,
      secret: undefined,
    });
    expect(location).toBe("/");
    expect(logged).toHaveLength(0);
  });

  it("the minted edit token expires after 15 minutes", async () => {
    const { reports, report } = await seededReports("jjjjjjjjjj");
    const grants = new InMemoryWriteGrantStore();
    const identities = new InMemoryIdentityStore();
    identities.seedUser(GRANTEE, "grantee@x.com");
    await grants.grant(report.id, "grantee@x.com", OWNER, GRANTEE);
    const { deps } = makeDeps(reports, { grants, identities });

    const location = await ownerOpenLocation(deps, {
      actor: { orgId: ORG, userId: GRANTEE },
      rawHandle: "jjjjjjjjjj",
      viewOrigin: VIEW,
      secret: SECRET,
    });
    const token = decodeURIComponent(location.split("?et=")[1] ?? "");
    const nowSeconds = Math.floor(NOW / 1000);
    expect(
      readEditToken(token, "jjjjjjjjjj", SECRET, nowSeconds + EDIT_TTL_SECONDS - 1),
    ).not.toBeNull();
    expect(
      readEditToken(token, "jjjjjjjjjj", SECRET, nowSeconds + EDIT_TTL_SECONDS + 1),
    ).toBeNull();
  });
});
