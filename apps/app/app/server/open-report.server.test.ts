// Unit tests for the owner-open decision — the ADR-0059 §4 security keystone,
// extended by ADR-0063 Phase 5: EVERY canWrite user (owner OR write-grantee)
// is now minted the SAME short-lived, slug-bound `scope:"edit"` token and
// lands in the unified in-viewer experience (`/edit?et=...`) — there is no
// longer a separate, higher-privilege `owner:true` access token minted from
// this route. `loadWritableReport` (isOwner OR hasWriteGrant, ADR-0060 §4)
// is now THE single gate; a user who is neither is bounced to "/" and never
// learns whether the report exists.
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
import { EDIT_TTL_SECONDS, ownerOpenLocation } from "./open-report.server";

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

describe("ownerOpenLocation — unified canWrite gate mints an edit token (ADR-0063 Phase 5)", () => {
  it("OWNER: mints an edit token (sub = owner) and redirects to the unified /edit experience", async () => {
    const { reports } = await seededReports("aaaaaaaaaa");
    const { deps, logged } = makeDeps(reports);
    const location = await ownerOpenLocation(deps, {
      actor: { orgId: ORG, userId: OWNER },
      rawHandle: "aaaaaaaaaa",
      viewOrigin: VIEW,
      secret: SECRET,
    });
    expect(location.startsWith(`${VIEW}/aaaaaaaaaa/edit?et=`)).toBe(true);
    const token = decodeURIComponent(location.split("?et=")[1] ?? "");
    const nowSeconds = Math.floor(NOW / 1000);
    const claims = readEditToken(token, "aaaaaaaaaa", SECRET, nowSeconds);
    expect(claims).toMatchObject({
      slug: "aaaaaaaaaa",
      sub: OWNER,
      scope: "edit",
      exp: nowSeconds + EDIT_TTL_SECONDS,
      sessionStart: nowSeconds, // /open always starts a FRESH session (ADR-0063 session cap)
    });
    expect(logged).toHaveLength(1); // the mint is audited
  });

  it("GRANTEE (non-owner canWrite): mints the SAME shape of edit token (sub = grantee)", async () => {
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
      sessionStart: nowSeconds, // /open always starts a FRESH session (ADR-0063 session cap)
    });
    expect(logged).toHaveLength(1); // audited exactly like the owner path — same capability now
  });

  it("KEYSTONE: a same-org non-owner, non-grantee is bounced to the dashboard — no token", async () => {
    const { reports } = await seededReports("bbbbbbbbbb");
    const { deps, logged } = makeDeps(reports);
    const location = await ownerOpenLocation(deps, {
      actor: { orgId: ORG, userId: COLLEAGUE }, // same org, NOT owner, NOT a write-grantee
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

  it("no secret configured (previews/dev): a canWrite OWNER falls through to the bare gated viewer — no token", async () => {
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

  it("no secret configured: a canWrite GRANTEE ALSO falls through to the bare gated viewer — the fallback is unified, not owner-only", async () => {
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
    expect(location).toBe(`${VIEW}/iiiiiiiiii`);
    expect(logged).toHaveLength(0);
  });

  it("no secret configured: the canWrite gate STILL runs first — a non-owner/non-grantee can't resolve a slug", async () => {
    const { reports } = await seededReports("dddddddddd");
    const { deps } = makeDeps(reports);
    const location = await ownerOpenLocation(deps, {
      actor: { orgId: ORG, userId: COLLEAGUE },
      rawHandle: "dddddddddd",
      viewOrigin: VIEW,
      secret: undefined,
    });
    // The canWrite gate runs BEFORE the no-secret branch (review #146's
    // reasoning, preserved): without it, any authenticated user could turn a
    // report_… id into its capability slug via the redirect Location.
    expect(location).toBe("/");
  });

  it("the minted edit token expires after EDIT_TTL_SECONDS, for the OWNER too (no more 24h owner token)", async () => {
    const { reports } = await seededReports("eeeeeeeeee");
    const { deps } = makeDeps(reports);
    const location = await ownerOpenLocation(deps, {
      actor: { orgId: ORG, userId: OWNER },
      rawHandle: "eeeeeeeeee",
      viewOrigin: VIEW,
      secret: SECRET,
    });
    const token = decodeURIComponent(location.split("?et=")[1] ?? "");
    const nowSeconds = Math.floor(NOW / 1000);
    expect(
      readEditToken(token, "eeeeeeeeee", SECRET, nowSeconds + EDIT_TTL_SECONDS - 1),
    ).not.toBeNull();
    expect(
      readEditToken(token, "eeeeeeeeee", SECRET, nowSeconds + EDIT_TTL_SECONDS + 1),
    ).toBeNull();
  });
});
