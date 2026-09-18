// Unit tests for the owner-open decision — the ADR-0059 §4 security keystone,
// extended by ADR-0063 Phase 5: EVERY canWrite user (owner OR write-grantee)
// is now minted the SAME short-lived, slug-bound `scope:"edit"` token and
// lands on the OWNER VIEW (`/view?et=...`, #363; it was `/edit` until the
// flip) — there is no
// longer a separate, higher-privilege `owner:true` access token minted from
// this route. `loadWritableReport` (isOwner OR hasWriteGrant, ADR-0060 §4)
// is now THE single gate; a user who is neither is bounced to "/" and never
// learns whether the report exists.
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
  readAccessToken,
  readEditToken,
  readGranteeReadToken,
  reportId,
  type Slug,
  userId,
  verifyAccessToken,
  versionId,
} from "arp-domain";
import { describe, expect, it } from "vitest";
import {
  EDIT_TTL_SECONDS,
  GRANTEE_READ_TTL_SECONDS,
  OWNER_TTL_SECONDS,
  ownerOpenLocation,
} from "./open-report.server";

const ORG = orgId("00000000-0000-7000-8000-0000000000a1");
const OTHER_ORG = orgId("00000000-0000-7000-8000-0000000000b1");
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
    readonly orgWriteGrants: InMemoryOrgWriteGrantStore;
    readonly identities: InMemoryIdentityStore;
  } = {
    grants: new InMemoryWriteGrantStore(),
    orgWriteGrants: new InMemoryOrgWriteGrantStore(),
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
  it("OWNER: mints an edit token (sub = owner) AND a fallback owner access token (oa=), redirects to the unified /edit experience", async () => {
    const { reports } = await seededReports("aaaaaaaaaa");
    const { deps, logged } = makeDeps(reports);
    const location = await ownerOpenLocation(deps, {
      actor: { orgId: ORG, userId: OWNER },
      rawHandle: "aaaaaaaaaa",
      viewOrigin: VIEW,
      secret: SECRET,
    });
    expect(location.startsWith(`${VIEW}/aaaaaaaaaa/view?et=`)).toBe(true); // #363: the owner view is the default landing
    const [etPart, oaPart] = location.split("?et=")[1]?.split("&oa=") ?? [];
    const nowSeconds = Math.floor(NOW / 1000);
    const token = decodeURIComponent(etPart ?? "");
    const claims = readEditToken(token, "aaaaaaaaaa", SECRET, nowSeconds);
    expect(claims).toMatchObject({
      slug: "aaaaaaaaaa",
      sub: OWNER,
      scope: "edit",
      exp: nowSeconds + EDIT_TTL_SECONDS,
      sessionStart: nowSeconds, // /open always starts a FRESH session (ADR-0063 session cap)
    });
    // Defense-in-depth (hotfix): the OWNER also gets a fallback owner access
    // token (`oa=`) so a failed edit-token round-trip on the view origin can
    // degrade to a read-only OWNER view instead of a lockout/unlock-wall.
    expect(oaPart).toBeTruthy();
    const ownerToken = decodeURIComponent(oaPart ?? "");
    const ownerClaims = readAccessToken(ownerToken, "aaaaaaaaaa", SECRET, nowSeconds);
    expect(ownerClaims).toMatchObject({
      slug: "aaaaaaaaaa",
      owner: true,
      exp: nowSeconds + OWNER_TTL_SECONDS,
    });
    expect(logged).toHaveLength(1); // the mint is audited (both tokens, one log line)
  });

  it("GRANTEE (non-owner canWrite): mints the SAME shape of edit token (sub = grantee), NO owner token (no privilege escalation)", async () => {
    const { reports, report } = await seededReports("ffffffffff");
    const grants = new InMemoryWriteGrantStore();
    const identities = new InMemoryIdentityStore();
    identities.seedUser(GRANTEE, "grantee@x.com");
    await grants.grant(report.id, "grantee@x.com", OWNER, GRANTEE);
    const { deps, logged } = makeDeps(reports, {
      grants,
      orgWriteGrants: new InMemoryOrgWriteGrantStore(),
      identities,
    });

    const location = await ownerOpenLocation(deps, {
      actor: { orgId: ORG, userId: GRANTEE },
      rawHandle: "ffffffffff",
      viewOrigin: VIEW,
      secret: SECRET,
    });

    expect(location.startsWith(`${VIEW}/ffffffffff/view?et=`)).toBe(true); // #363: the owner view is the default landing
    expect(location).not.toContain("&oa="); // review #146: a grantee NEVER gets an owner:true token
    const token = decodeURIComponent(location.split("?et=")[1]?.split("&gr=")[0] ?? "");
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

  it("ORG-WRITE GRANTEE (ADR-0078): same edit token, and NEVER an owner:true one", async () => {
    // The ADR-0063 keystone, re-pinned for the third canWrite leg. An org-write
    // colleague reaches /open through loadWritableReport → canWrite exactly as
    // a personal grantee does, and must come out with the SAME capability:
    // `scope: "edit"`, subject = themselves. Minting `owner:true` here would be
    // a privilege escalation — that token bypasses every share gate, and its
    // un-revocability (ADR-0056) would then apply to every member of the org.
    const { reports, report } = await seededReports("gggggggggg");
    const orgWriteGrants = new InMemoryOrgWriteGrantStore();
    await orgWriteGrants.grant(report.id, ORG, OWNER);
    const { deps, logged } = makeDeps(reports, {
      grants: new InMemoryWriteGrantStore(),
      orgWriteGrants,
      identities: new InMemoryIdentityStore(),
    });

    const location = await ownerOpenLocation(deps, {
      actor: { orgId: ORG, userId: COLLEAGUE },
      rawHandle: "gggggggggg",
      viewOrigin: VIEW,
      secret: SECRET,
    });

    expect(location.startsWith(`${VIEW}/gggggggggg/view?et=`)).toBe(true); // #363: the owner view is the default landing
    expect(location).not.toContain("&oa=");
    const token = decodeURIComponent(location.split("?et=")[1]?.split("&gr=")[0] ?? "");
    const nowSeconds = Math.floor(NOW / 1000);
    expect(readEditToken(token, "gggggggggg", SECRET, nowSeconds)).toMatchObject({
      slug: "gggggggggg",
      sub: COLLEAGUE,
      scope: "edit",
    });
    expect(logged).toHaveLength(1);
  });

  it("ORG-WRITE is org-matched: a CROSS-ORG actor is still bounced (ADR-0078 §1)", async () => {
    const { reports, report } = await seededReports("hhhhhhhhhh");
    const orgWriteGrants = new InMemoryOrgWriteGrantStore();
    await orgWriteGrants.grant(report.id, ORG, OWNER);
    const { deps } = makeDeps(reports, {
      grants: new InMemoryWriteGrantStore(),
      orgWriteGrants,
      identities: new InMemoryIdentityStore(),
    });

    const location = await ownerOpenLocation(deps, {
      actor: { orgId: OTHER_ORG, userId: GRANTEE },
      rawHandle: "hhhhhhhhhh",
      viewOrigin: VIEW,
      secret: SECRET,
    });
    expect(location).not.toContain("?et="); // no capability minted, to EITHER destination
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
    const { deps, logged } = makeDeps(reports, {
      grants,
      orgWriteGrants: new InMemoryOrgWriteGrantStore(),
      identities,
    });

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
    const token = decodeURIComponent(location.split("?et=")[1]?.split("&oa=")[0] ?? "");
    const nowSeconds = Math.floor(NOW / 1000);
    expect(
      readEditToken(token, "eeeeeeeeee", SECRET, nowSeconds + EDIT_TTL_SECONDS - 1),
    ).not.toBeNull();
    expect(
      readEditToken(token, "eeeeeeeeee", SECRET, nowSeconds + EDIT_TTL_SECONDS + 1),
    ).toBeNull();
  });
});

// --- The Grantee read token mint (ADR-0091) ----------------------------------
//
// `/open` is the ONE mint (ADR-0059 §4) and it already knows whether the actor
// owns the report, so the grantee's read capability is decided by the SAME
// `isOwner` ternary that decides the owner's `oa=`. That structure — one
// boolean, two mutually exclusive outcomes — is the no-escalation guarantee;
// these tests pin both halves of it.
describe("ownerOpenLocation — the Grantee read token (ADR-0091)", () => {
  async function granteeOpen(slugStr: string) {
    const { reports, report } = await seededReports(slugStr);
    const grants = new InMemoryWriteGrantStore();
    const identities = new InMemoryIdentityStore();
    identities.seedUser(GRANTEE, "grantee@x.com");
    await grants.grant(report.id, "grantee@x.com", OWNER, GRANTEE);
    const { deps, logged } = makeDeps(reports, {
      grants,
      orgWriteGrants: new InMemoryOrgWriteGrantStore(),
      identities,
    });
    const location = await ownerOpenLocation(deps, {
      actor: { orgId: ORG, userId: GRANTEE },
      rawHandle: slugStr,
      viewOrigin: VIEW,
      secret: SECRET,
    });
    return { location, logged };
  }

  it("GRANTEE: gets a `gr=` grantee read token and NO `oa=` — the two are mutually exclusive", async () => {
    const { location } = await granteeOpen("gggggggggg");
    expect(location).toContain("&gr=");
    expect(location).not.toContain("&oa=");

    const gr = decodeURIComponent(location.split("&gr=")[1] ?? "");
    const nowSeconds = Math.floor(NOW / 1000);
    expect(readGranteeReadToken(gr, "gggggggggg", SECRET, nowSeconds)).toEqual({
      slug: "gggggggggg",
      sub: GRANTEE,
      scope: "granteeRead",
      exp: nowSeconds + GRANTEE_READ_TTL_SECONDS,
    });
  });

  it("the grantee's token is NOT an owner token — the review-#146 escalation, pinned at the mint", async () => {
    // The point of ADR-0091: the grantee gets a real read capability without
    // anyone ever minting `owner: true` for a non-owner. Checked here at the
    // mint rather than only at the redeemer, because the redeemer is one
    // refactor away from a second caller.
    const { location } = await granteeOpen("hhhhhhhhhh");
    const gr = decodeURIComponent(location.split("&gr=")[1] ?? "");
    const nowSeconds = Math.floor(NOW / 1000);
    expect(verifyAccessToken(gr, "hhhhhhhhhh", SECRET, nowSeconds)).toBe(false);
    expect(readGranteeReadToken(gr, "hhhhhhhhhh", SECRET, nowSeconds)).not.toHaveProperty("owner");
  });

  it("the grantee read token lives EDIT_TTL_SECONDS, not the owner's 24h (ADR-0091 §4)", async () => {
    // Ownership cannot be revoked; a write grant can. So the grantee's read
    // capability expires with their edit capability and the session repairs
    // through this very mint, which re-runs the LIVE canWrite check.
    expect(GRANTEE_READ_TTL_SECONDS).toBe(EDIT_TTL_SECONDS);
    const { location } = await granteeOpen("iiiiiiiiii");
    const gr = decodeURIComponent(location.split("&gr=")[1] ?? "");
    const nowSeconds = Math.floor(NOW / 1000);
    expect(
      readGranteeReadToken(gr, "iiiiiiiiii", SECRET, nowSeconds + EDIT_TTL_SECONDS),
    ).toBeNull();
  });

  it("audits the grantee mint distinguishably — granteeReadMinted true, ownerFallbackMinted false", async () => {
    const { logged } = await granteeOpen("jjjjjjjjjj");
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      fields: { ownerFallbackMinted: false, granteeReadMinted: true, userId: GRANTEE },
    });
  });

  it("OWNER: gets `oa=` and NEVER `gr=` — the other half of the exclusivity", async () => {
    const { reports } = await seededReports("kkkkkkkkkk");
    const { deps, logged } = makeDeps(reports);
    const location = await ownerOpenLocation(deps, {
      actor: { orgId: ORG, userId: OWNER },
      rawHandle: "kkkkkkkkkk",
      viewOrigin: VIEW,
      secret: SECRET,
    });
    expect(location).toContain("&oa=");
    expect(location).not.toContain("&gr=");
    expect(logged[0]).toMatchObject({
      fields: { ownerFallbackMinted: true, granteeReadMinted: false },
    });
  });

  it("no secret configured: neither token is minted — the fail-closed fall-through is unchanged", async () => {
    const { reports, report } = await seededReports("llllllllll");
    const grants = new InMemoryWriteGrantStore();
    const identities = new InMemoryIdentityStore();
    identities.seedUser(GRANTEE, "grantee@x.com");
    await grants.grant(report.id, "grantee@x.com", OWNER, GRANTEE);
    const { deps } = makeDeps(reports, {
      grants,
      orgWriteGrants: new InMemoryOrgWriteGrantStore(),
      identities,
    });
    const location = await ownerOpenLocation(deps, {
      actor: { orgId: ORG, userId: GRANTEE },
      rawHandle: "llllllllll",
      viewOrigin: VIEW,
      secret: undefined,
    });
    expect(location).toBe(`${VIEW}/llllllllll`);
    expect(location).not.toContain("gr=");
  });
});

// --- #363: owner-open lands on the OWNER VIEW -------------------------------
//
// ADR-0089 built the owner view; ADR-0089 §9 left the redirect flip to this
// ticket, and named exactly what it needs from that record: keep appending
// `&oa=` for owners (§4c depends on it) and point at `/<slug>/view`.
describe("ownerOpenLocation — the destination (#363)", () => {
  it("an OWNER lands on the owner view, with `et=` and `oa=` threaded exactly as before", async () => {
    const { reports } = await seededReports("mmmmmmmmmm");
    const { deps } = makeDeps(reports);
    const location = await ownerOpenLocation(deps, {
      actor: { orgId: ORG, userId: OWNER },
      rawHandle: "mmmmmmmmmm",
      viewOrigin: VIEW,
      secret: SECRET,
    });

    expect(location.startsWith(`${VIEW}/mmmmmmmmmm/view?et=`)).toBe(true);
    expect(location).toContain("&oa=");
    // The capability itself is unchanged — only where it is spent.
    const et = decodeURIComponent(location.split("?et=")[1]?.split("&oa=")[0] ?? "");
    const nowSeconds = Math.floor(NOW / 1000);
    expect(readEditToken(et, "mmmmmmmmmm", SECRET, nowSeconds)).toMatchObject({
      sub: OWNER,
      scope: "edit",
      exp: nowSeconds + EDIT_TTL_SECONDS,
    });
    const oa = decodeURIComponent(location.split("&oa=")[1] ?? "");
    expect(readAccessToken(oa, "mmmmmmmmmm", SECRET, nowSeconds)).toMatchObject({ owner: true });
  });

  it("a GRANTEE lands on the owner view too, with `gr=` — the audience rules of #361 are unchanged", async () => {
    const { reports, report } = await seededReports("nnnnnnnnnn");
    const grants = new InMemoryWriteGrantStore();
    const identities = new InMemoryIdentityStore();
    identities.seedUser(GRANTEE, "grantee@x.com");
    await grants.grant(report.id, "grantee@x.com", OWNER, GRANTEE);
    const { deps } = makeDeps(reports, {
      grants,
      orgWriteGrants: new InMemoryOrgWriteGrantStore(),
      identities,
    });
    const location = await ownerOpenLocation(deps, {
      actor: { orgId: ORG, userId: GRANTEE },
      rawHandle: "nnnnnnnnnn",
      viewOrigin: VIEW,
      secret: SECRET,
    });
    expect(location.startsWith(`${VIEW}/nnnnnnnnnn/view?et=`)).toBe(true);
    expect(location).toContain("&gr=");
  });

  it("a GRANTEE heading for the EDITOR carries no `gr=` — nothing on /edit can consume it", async () => {
    // ADR-0091 §3 scopes `arp_view_gr` to `Path=/<slug>/view` precisely so the
    // grantee's read capability is NEVER sent on `/edit` — that absence is what
    // makes the Edit action funnel back through this mint for a live `canWrite`
    // re-check (ADR-0089 §4b). `EDIT_SURFACE` accordingly has no grantee cookie,
    // so a `gr=` arriving on the editor URL is read by nothing. Appending it
    // anyway would put a live 15-minute signed capability into the address bar,
    // the history and the referer of a surface that cannot use it — exactly the
    // exposure ADR-0089 §4's "no token is ever served on" posture exists to
    // avoid. `oa=` is different and stays: `/edit` genuinely consumes it.
    const { reports, report } = await seededReports("rrrrrrrrrr");
    const grants = new InMemoryWriteGrantStore();
    const identities = new InMemoryIdentityStore();
    identities.seedUser(GRANTEE, "grantee@x.com");
    await grants.grant(report.id, "grantee@x.com", OWNER, GRANTEE);
    const { deps } = makeDeps(reports, {
      grants,
      orgWriteGrants: new InMemoryOrgWriteGrantStore(),
      identities,
    });
    const location = await ownerOpenLocation(deps, {
      actor: { orgId: ORG, userId: GRANTEE },
      rawHandle: "rrrrrrrrrr",
      viewOrigin: VIEW,
      secret: SECRET,
      destination: "editor",
    });
    // Still admitted, still gets the edit token — only the unusable read
    // capability is withheld.
    expect(location.startsWith(`${VIEW}/rrrrrrrrrr/edit?et=`)).toBe(true);
    expect(location).not.toContain("&gr=");
    expect(location).not.toContain("&oa=");
  });

  it('`destination: "editor"` still mints into the EDITOR — this is what keeps Edit reachable', async () => {
    // The owner view's Edit action is a plain link to `/<slug>/edit`, which
    // holds no capability under that Path and therefore FUNNELS through this
    // one mint (ADR-0089 §4b — that hop IS the live canWrite re-check). With
    // the flip, a funnel that forgot the destination would send the user
    // straight back to the owner view and Edit would never open the editor.
    const { reports } = await seededReports("oooooooooo");
    const { deps } = makeDeps(reports);
    const location = await ownerOpenLocation(deps, {
      actor: { orgId: ORG, userId: OWNER },
      rawHandle: "oooooooooo",
      viewOrigin: VIEW,
      secret: SECRET,
      destination: "editor",
    });
    expect(location.startsWith(`${VIEW}/oooooooooo/edit?et=`)).toBe(true);
    expect(location).toContain("&oa=");
  });

  it("the destination changes nothing about WHO is admitted — a non-canWrite user is still bounced", async () => {
    const { reports } = await seededReports("pppppppppp");
    const { deps } = makeDeps(reports);
    for (const destination of ["ownerView", "editor"] as const) {
      await expect(
        ownerOpenLocation(deps, {
          actor: { orgId: ORG, userId: COLLEAGUE },
          rawHandle: "pppppppppp",
          viewOrigin: VIEW,
          secret: SECRET,
          destination,
        }),
      ).resolves.toBe("/");
    }
  });

  it("no secret configured: BOTH destinations fall through to the bare gated viewer, as today", async () => {
    const { reports } = await seededReports("qqqqqqqqqq");
    const { deps } = makeDeps(reports);
    for (const destination of ["ownerView", "editor"] as const) {
      await expect(
        ownerOpenLocation(deps, {
          actor: { orgId: ORG, userId: OWNER },
          rawHandle: "qqqqqqqqqq",
          viewOrigin: VIEW,
          secret: undefined,
          destination,
        }),
      ).resolves.toBe(`${VIEW}/qqqqqqqqqq`);
    }
  });
});

// ---------------------------------------------------------------------------
// The editor panel hint through the mint (#382, completing #377).
//
// The owner view's Versions action is a plain link to `/<slug>/edit?panel=
// versions` that deliberately holds no capability under that Path, so the
// FIRST click funnels here for the live `canWrite` re-check (ADR-0089 §4b).
// This function builds the location that funnel comes back to — so if it
// drops the hint, the editor opens on the comments tab and the owner's one
// click was spent on nothing.
//
// The mint FORWARDS the hint; it never routes on it. `?to=` alone chooses the
// destination (unchanged), the `loadWritableReport` gate alone chooses who is
// admitted (unchanged), and the hint is appended afterwards to whatever
// location those two already decided.
// ---------------------------------------------------------------------------
describe("ownerOpenLocation — the editor panel hint (#382)", () => {
  it("threads the hint into the editor hand-off, alongside the capability", async () => {
    const { reports } = await seededReports("sssssssssm");
    const { deps } = makeDeps(reports);
    const location = await ownerOpenLocation(deps, {
      actor: { orgId: ORG, userId: OWNER },
      rawHandle: "sssssssssm",
      viewOrigin: VIEW,
      secret: SECRET,
      destination: "editor",
      panel: "versions",
    });

    expect(location.startsWith(`${VIEW}/sssssssssm/edit?et=`)).toBe(true);
    // Last, after the capability: the tokens stay adjacent to `et=` and the
    // hint is visibly the thing that grants nothing.
    expect(location.endsWith("&panel=versions")).toBe(true);
    expect(location).toContain("&oa=");
  });

  it("threads `comments` too — the enum, not one special-cased value", async () => {
    const { reports } = await seededReports("sssssssssn");
    const { deps } = makeDeps(reports);
    await expect(
      ownerOpenLocation(deps, {
        actor: { orgId: ORG, userId: OWNER },
        rawHandle: "sssssssssn",
        viewOrigin: VIEW,
        secret: SECRET,
        destination: "editor",
        panel: "comments",
      }),
    ).resolves.toContain("&panel=comments");
  });

  it.each([
    ["an unknown panel", "diff"],
    ["the wrong case", "Versions"],
    ["an injected parameter", "versions&et=stolen"],
    ["an absolute URL", "https://evil.example/x"],
    ["an empty value", ""],
    ["nothing at all", null],
  ])("drops %s before the location is built", async (_name, raw) => {
    const { reports } = await seededReports("ssssssssso");
    const { deps } = makeDeps(reports);
    const location = await ownerOpenLocation(deps, {
      actor: { orgId: ORG, userId: OWNER },
      rawHandle: "ssssssssso",
      viewOrigin: VIEW,
      secret: SECRET,
      destination: "editor",
      panel: raw,
    });
    expect(location).not.toContain("panel");
    // …and the hand-off is otherwise exactly the one it builds with no hint
    // at all: a rubbish hint costs the user nothing.
    expect(location.startsWith(`${VIEW}/ssssssssso/edit?et=`)).toBe(true);
  });

  it("never rides the OWNER VIEW hand-off — that surface has no side panel", async () => {
    // Only the gate's `/edit` funnel forwards a hint, so this shape arrives
    // only if someone hand-crafts it. The owner view renders no panel, so the
    // parameter would sit unread in an owner's address bar and history.
    const { reports } = await seededReports("ssssssssnp");
    const { deps } = makeDeps(reports);
    const location = await ownerOpenLocation(deps, {
      actor: { orgId: ORG, userId: OWNER },
      rawHandle: "ssssssssnp",
      viewOrigin: VIEW,
      secret: SECRET,
      panel: "versions",
    });
    expect(location.startsWith(`${VIEW}/ssssssssnp/view?et=`)).toBe(true);
    expect(location).not.toContain("panel");
  });

  it("admits nobody a hintless request would not admit", async () => {
    const { reports } = await seededReports("ssssssssnq");
    const { deps } = makeDeps(reports);
    await expect(
      ownerOpenLocation(deps, {
        actor: { orgId: ORG, userId: COLLEAGUE },
        rawHandle: "ssssssssnq",
        viewOrigin: VIEW,
        secret: SECRET,
        destination: "editor",
        panel: "versions",
      }),
    ).resolves.toBe("/");
  });

  it("no secret configured: the bare gated viewer, with no hint on it", async () => {
    // Nothing was minted, so there is no editor to land in — the fall-through
    // is the public viewer, and a panel hint there names nothing.
    const { reports } = await seededReports("ssssssssnr");
    const { deps } = makeDeps(reports);
    await expect(
      ownerOpenLocation(deps, {
        actor: { orgId: ORG, userId: OWNER },
        rawHandle: "ssssssssnr",
        viewOrigin: VIEW,
        secret: undefined,
        destination: "editor",
        panel: "versions",
      }),
    ).resolves.toBe(`${VIEW}/ssssssssnr`);
  });

  it("changes NOTHING about the capability or its audit trail", async () => {
    // The mint is the security keystone (ADR-0059 §4). A hint that altered the
    // token, its TTL, its claims or what the mint logs would be a capability
    // wearing a hint's clothes.
    const withHint = await seededReports("ssssssssns");
    const hinted = makeDeps(withHint.reports);
    const hintedLocation = await ownerOpenLocation(hinted.deps, {
      actor: { orgId: ORG, userId: OWNER },
      rawHandle: "ssssssssns",
      viewOrigin: VIEW,
      secret: SECRET,
      destination: "editor",
      panel: "versions",
    });
    const bare = makeDeps(withHint.reports);
    const bareLocation = await ownerOpenLocation(bare.deps, {
      actor: { orgId: ORG, userId: OWNER },
      rawHandle: "ssssssssns",
      viewOrigin: VIEW,
      secret: SECRET,
      destination: "editor",
    });

    expect(hintedLocation).toBe(`${bareLocation}&panel=versions`);
    expect(hinted.logged).toEqual(bare.logged);
    expect(JSON.stringify(hinted.logged)).not.toContain("panel");
  });
});
