// Decision-matrix tests for decideServe — the ONE viewer gate behind both
// GET /<slug> (purpose: "view") and GET /<slug>/edit (purpose: "edit").
// Architecture-review candidate 2: the gate absorbs, verbatim in behavior,
// every branch the two route loaders took before the extraction —
//   • the ?v=N ordinal parse (version-query.ts, ADR-0038 §3)
//   • the resolveViewableReport outcome mapping (deleted→410 / flagged→451 /
//     notfound→404 / scanning→interstitial, ADR-0038 §2)
//   • resolveAccessDecision + the arp_unlock cookie read/build (ADR-0056)
//   • the arp_edit cookie + resolveEditAccess path (ADR-0063), incl. the
//     `oa=` owner-access degrade hand-off (Phase 5-E hotfix)
//   • both query-token → Set-Cookie → 303-clean-URL dances.
// Fixture style mirrors resolve-access.test.ts / view-report.test.ts: real
// minted tokens (mintAccessToken/mintEditToken), real Report aggregates, the
// in-memory ports — never hand-rolled token strings or mocked domain logic.
import type { ReportRepository } from "arp-application";
import { FixedClock, InMemoryGrantStore, InMemoryReportRepository } from "arp-application/testing";
import {
  type Acl,
  type AppError,
  addVersion,
  applyScanResult,
  createReport,
  err,
  folderId,
  makeSlug,
  mintAccessToken,
  mintEditToken,
  orgId,
  type Report,
  type Result,
  reportId,
  type TerminalScanStatus,
  userId,
  versionId,
} from "arp-domain";
import { describe, expect, it, vi } from "vitest";
import { type Decision, decideServe, degradeTargetFor, type GateDeps } from "./gate.server";

const SECRET = "view-access-secret";
const APP_ORIGIN = "https://app.example.test";
const SLUG = "abcde12345";
const OTHER_SLUG = "zzzzzzzzzz";
const NOW = 1_700_000_000;
const RID = reportId("00000000-0000-4000-8000-0000000000a1");
const VID = versionId("00000000-0000-4000-8000-0000000000b1");
const VID2 = versionId("00000000-0000-4000-8000-0000000000b2");
const VID3 = versionId("00000000-0000-4000-8000-0000000000b3");
const VID4 = versionId("00000000-0000-4000-8000-0000000000b4");

const PUBLIC: Acl = { mode: "public" };
const PRIVATE: Acl = { mode: "private" };
const PW: Acl = { mode: "password", passwordHash: "h" };
const ORG: Acl = { mode: "org" };
const ALLOW: Acl = { mode: "allowlist", allowedEmails: ["a@b.com"], accessTtlSeconds: 3600 };

function buildReport(
  opts: { verdict?: TerminalScanStatus; deleted?: boolean; acl?: Acl } = {},
): Report {
  const slug = makeSlug(SLUG);
  if (!slug.ok) throw new Error("test slug invalid");
  const { report } = createReport({
    id: RID,
    orgId: orgId("00000000-0000-4000-8000-000000000001"),
    folderId: folderId("00000000-0000-4000-8000-000000000003"),
    slug: slug.value,
    title: "Report",
    versionId: VID,
    contentHash: "a".repeat(64),
    uploadedBy: userId("00000000-0000-4000-8000-000000000002"),
    manifest: { entryDocument: "index.html", files: ["index.html"] },
    sizeBytes: 11,
  });
  let r = opts.verdict ? applyScanResult(report, VID, opts.verdict).report : report;
  if (opts.deleted) r = { ...r, deletedAt: 1000 };
  if (opts.acl) r = { ...r, acl: opts.acl };
  return r;
}

// v1 clean + live, v2 pending, v3 flagged, v4 blocked — the ?v=N matrix
// (mirrors view-report.test.ts's buildMultiVersionReport).
function buildMultiVersionReport(acl: Acl): Report {
  let report = buildReport({ verdict: "clean", acl });
  const nextVersion = (id: typeof VID2) => ({
    versionId: id,
    contentHash: "b".repeat(64),
    uploadedBy: userId("00000000-0000-4000-8000-000000000002"),
    manifest: { entryDocument: "index.html", files: ["index.html"] },
    sizeBytes: 11,
  });
  const withV2 = addVersion(report, nextVersion(VID2));
  if (!withV2.ok) throw new Error("addVersion v2 failed");
  report = withV2.value.report; // v2 left pending
  const withV3 = addVersion(report, nextVersion(VID3));
  if (!withV3.ok) throw new Error("addVersion v3 failed");
  report = applyScanResult(withV3.value.report, VID3, "flagged").report;
  const withV4 = addVersion(report, nextVersion(VID4));
  if (!withV4.ok) throw new Error("addVersion v4 failed");
  report = applyScanResult(withV4.value.report, VID4, "blocked").report;
  // applyScanResult(clean) promoted v1 live; keep acl override intact
  return { ...report, acl };
}

async function repoWith(report?: Report): Promise<InMemoryReportRepository> {
  const repo = new InMemoryReportRepository();
  if (report) await repo.save(report);
  return repo;
}

const failingRepo = {
  findBySlug: async (): Promise<Result<Report | null, AppError>> =>
    err({ kind: "Unexpected", message: "boom" }),
} as unknown as ReportRepository;

function makeDeps(overrides: Partial<GateDeps> = {}): GateDeps {
  return {
    reports: new InMemoryReportRepository(),
    grants: new InMemoryGrantStore(new FixedClock(NOW * 1000)),
    secret: SECRET,
    appOrigin: APP_ORIGIN,
    nowSeconds: NOW,
    ...overrides,
  };
}

function request(path: string, cookie?: string): Request {
  return new Request(`https://view.example.test${path}`, {
    headers: cookie ? { cookie } : undefined,
  });
}

async function decideView(
  report: Report | undefined,
  opts: {
    path?: string;
    cookie?: string;
    secret?: string | undefined;
    appOrigin?: string | undefined;
    grants?: InMemoryGrantStore;
    reports?: ReportRepository;
    now?: number;
  } = {},
): Promise<Decision> {
  const deps = makeDeps({
    reports: opts.reports ?? (await repoWith(report)),
    ...(opts.grants ? { grants: opts.grants } : {}),
    secret: "secret" in opts ? opts.secret : SECRET,
    appOrigin: "appOrigin" in opts ? opts.appOrigin : APP_ORIGIN,
    nowSeconds: opts.now ?? NOW,
  });
  return decideServe(request(opts.path ?? `/${SLUG}`, opts.cookie), SLUG, "view", deps);
}

async function decideEdit(
  report: Report | undefined,
  opts: {
    path?: string;
    cookie?: string;
    secret?: string | undefined;
    appOrigin?: string | undefined;
    reports?: ReportRepository;
    now?: number;
    warn?: (line: string) => void;
  } = {},
): Promise<Decision> {
  const deps = makeDeps({
    reports: opts.reports ?? (await repoWith(report)),
    secret: "secret" in opts ? opts.secret : SECRET,
    appOrigin: "appOrigin" in opts ? opts.appOrigin : APP_ORIGIN,
    nowSeconds: opts.now ?? NOW,
    ...(opts.warn ? { warn: opts.warn } : {}),
  });
  return decideServe(request(opts.path ?? `/${SLUG}/edit`, opts.cookie), SLUG, "edit", deps);
}

const accessToken = (extra: Parameters<typeof mintAccessToken>[4] = {}, ttl = 900, now = NOW) =>
  mintAccessToken(SLUG, ttl, SECRET, now, extra);
const editToken = (ttl = 900, now = NOW, slug = SLUG) =>
  mintEditToken(slug, "user_1", ttl, SECRET, now);
/** A GENUINE `oa=` fallback — the exact shape `ownerOpenLocation` mints, at its
 *  real `OWNER_TTL_SECONDS` (24h, deliberately outliving the 15-min edit
 *  capability it backs up). The gate now verifies `oa` (signature, slug,
 *  expiry, `owner:true`) before honoring it, so an arbitrary string is no
 *  longer an owner fallback and these tests must mint the real thing. */
const ownerAccess = (ttl = 86_400, now = NOW, slug = SLUG) =>
  mintAccessToken(slug, ttl, SECRET, now, { owner: true });

// ---------------------------------------------------------------------------
// Slug validation — shared by both purposes (the routes' makeSlug guard).
// ---------------------------------------------------------------------------
describe("decideServe — slug validation", () => {
  it.each([
    "",
    "short",
    "way-too-long-for-a-slug",
    "bad!chars!",
  ])("view: invalid slug %j → error 404 (reason-opaque)", async (bad) => {
    const decision = await decideServe(request(`/${bad}`), bad, "view", makeDeps());
    expect(decision).toEqual({ kind: "error", status: 404, message: "Not found" });
  });

  it("edit: invalid slug → error 404", async () => {
    const decision = await decideServe(request("/nope/edit"), "nope", "edit", makeDeps());
    expect(decision).toEqual({ kind: "error", status: 404, message: "Not found" });
  });
});

// ---------------------------------------------------------------------------
// purpose: "view" — the ADR-0038 §2 outcome mapping (BEFORE the ACL gate).
// ---------------------------------------------------------------------------
describe("decideServe view — resolveViewableReport outcome mapping", () => {
  it("repository failure → error 500 'Lookup failed'", async () => {
    expect(await decideView(undefined, { reports: failingRepo })).toEqual({
      kind: "error",
      status: 500,
      message: "Lookup failed",
    });
  });

  it("unknown slug → error 404 'Not found'", async () => {
    expect(await decideView(undefined)).toEqual({
      kind: "error",
      status: 404,
      message: "Not found",
    });
  });

  it("deleted report → error 410, even for a private report with no token (outcome precedes ACL)", async () => {
    expect(
      await decideView(buildReport({ verdict: "clean", deleted: true, acl: PRIVATE })),
    ).toEqual({ kind: "error", status: 410, message: "No longer available" });
  });

  it("flagged (newest flagged, no live) → error 451", async () => {
    expect(await decideView(buildReport({ verdict: "flagged", acl: PUBLIC }))).toEqual({
      kind: "error",
      status: 451,
      message: "Unavailable — flagged for review",
    });
  });

  it("blocked (no servable version) → error 404 (reason-opaque)", async () => {
    expect(await decideView(buildReport({ verdict: "blocked", acl: PUBLIC }))).toEqual({
      kind: "error",
      status: 404,
      message: "Not found",
    });
  });

  it("public + clean live → serve, carrying the report + live version (no edit payload)", async () => {
    const report = buildReport({ verdict: "clean", acl: PUBLIC });
    const decision = await decideView(report);
    expect(decision.kind).toBe("serve");
    if (decision.kind === "serve") {
      expect(decision.report.id).toBe(RID);
      expect(decision.version.id).toBe(VID);
      expect(decision.edit).toBeUndefined();
    }
  });

  it("public + scanning (newest pending, no live) → interstitial", async () => {
    expect((await decideView(buildReport({ acl: PUBLIC }))).kind).toBe("interstitial");
  });
});

// ---------------------------------------------------------------------------
// purpose: "view" — the ?v=N ordinal path (version-query.ts absorbed;
// same scan-status state machine, same ACL gate — ADR-0038 §3).
// ---------------------------------------------------------------------------
describe("decideServe view — ?v=N ordinal", () => {
  const report = () => buildMultiVersionReport(PUBLIC);

  it("?v=1 (clean) → serve that version", async () => {
    const decision = await decideView(report(), { path: `/${SLUG}?v=1` });
    expect(decision.kind).toBe("serve");
    if (decision.kind === "serve") expect(decision.version.id).toBe(VID);
  });

  it("?v=2 (pending) → interstitial", async () => {
    expect((await decideView(report(), { path: `/${SLUG}?v=2` })).kind).toBe("interstitial");
  });

  it("?v=3 (flagged) → error 451", async () => {
    expect(await decideView(report(), { path: `/${SLUG}?v=3` })).toEqual({
      kind: "error",
      status: 451,
      message: "Unavailable — flagged for review",
    });
  });

  it("?v=4 (blocked) → error 404, same as out-of-range (reason-opaque)", async () => {
    expect(await decideView(report(), { path: `/${SLUG}?v=4` })).toEqual({
      kind: "error",
      status: 404,
      message: "Not found",
    });
  });

  it.each(["0", "99"])("?v=%s (out of range) → error 404", async (v) => {
    expect(await decideView(report(), { path: `/${SLUG}?v=${v}` })).toEqual({
      kind: "error",
      status: 404,
      message: "Not found",
    });
  });

  it.each([
    "abc",
    "1.5",
    "-1",
    "%20 1",
    "1e2",
  ])("malformed ?v=%s is treated as absent → live default", async (v) => {
    const decision = await decideView(report(), { path: `/${SLUG}?v=${v}` });
    expect(decision.kind).toBe("serve");
    if (decision.kind === "serve") expect(decision.version.id).toBe(VID);
  });

  it("?v=N on a PRIVATE report is behind the same ACL gate (no token → unlock redirect)", async () => {
    expect(await decideView(buildMultiVersionReport(PW), { path: `/${SLUG}?v=1` })).toEqual({
      kind: "redirect",
      to: `${APP_ORIGIN}/unlock/${SLUG}`,
    });
  });
});

// ---------------------------------------------------------------------------
// purpose: "view" — the ADR-0056 ACL gate (resolveAccessDecision + arp_unlock).
// ---------------------------------------------------------------------------
describe("decideServe view — ACL gate", () => {
  it.each<[string, Acl]>([
    ["private", PRIVATE],
    ["password", PW],
    ["org", ORG],
    ["allowlist", ALLOW],
  ])("%s mode with no token → redirect to the app unlock page", async (_name, acl) => {
    expect(await decideView(buildReport({ verdict: "clean", acl }))).toEqual({
      kind: "redirect",
      to: `${APP_ORIGIN}/unlock/${SLUG}`,
    });
  });

  it("private mode with no token AND no appOrigin → error 503 (fail closed)", async () => {
    expect(
      await decideView(buildReport({ verdict: "clean", acl: PRIVATE }), {
        appOrigin: undefined,
      }),
    ).toEqual({
      kind: "error",
      status: 503,
      message: "Private report — viewing is not available here",
    });
  });

  it("unset secret fails closed → unlock redirect even with an (empty-key-forged) token", async () => {
    const forged = mintAccessToken(SLUG, 900, "", NOW, { mode: "password" });
    expect(
      await decideView(buildReport({ verdict: "clean", acl: PW }), {
        path: `/${SLUG}?access=${encodeURIComponent(forged)}`,
        secret: undefined,
      }),
    ).toEqual({ kind: "redirect", to: `${APP_ORIGIN}/unlock/${SLUG}` });
  });

  it("valid ?access= query token → setCookieAndRedirect: arp_unlock cookie + 303-clean-URL target", async () => {
    const token = accessToken({ mode: "password" });
    expect(
      await decideView(buildReport({ verdict: "clean", acl: PW }), {
        path: `/${SLUG}?access=${encodeURIComponent(token)}`,
      }),
    ).toEqual({
      kind: "setCookieAndRedirect",
      cookies: [`arp_unlock=${token}; Path=/${SLUG}; Max-Age=900; HttpOnly; Secure; SameSite=Lax`],
      to: `/${SLUG}`,
    });
  });

  it("valid arp_unlock cookie → serve (multi-cookie header parsed correctly)", async () => {
    const token = accessToken({ mode: "password" });
    const decision = await decideView(buildReport({ verdict: "clean", acl: PW }), {
      cookie: `foo=bar; arp_unlock=${token}; baz=qux`,
    });
    expect(decision.kind).toBe("serve");
  });

  it("an empty arp_unlock cookie value is treated as absent → unlock", async () => {
    expect(
      await decideView(buildReport({ verdict: "clean", acl: PW }), { cookie: "arp_unlock=" }),
    ).toEqual({ kind: "redirect", to: `${APP_ORIGIN}/unlock/${SLUG}` });
  });

  it("expired cookie token → unlock redirect", async () => {
    const token = accessToken({ mode: "password" });
    expect(
      await decideView(buildReport({ verdict: "clean", acl: PW }), {
        cookie: `arp_unlock=${token}`,
        now: NOW + 901,
      }),
    ).toEqual({ kind: "redirect", to: `${APP_ORIGIN}/unlock/${SLUG}` });
  });

  it("token minted for another slug → unlock redirect", async () => {
    const other = mintAccessToken(OTHER_SLUG, 900, SECRET, NOW, { mode: "password" });
    expect(
      await decideView(buildReport({ verdict: "clean", acl: PW }), {
        cookie: `arp_unlock=${other}`,
      }),
    ).toEqual({ kind: "redirect", to: `${APP_ORIGIN}/unlock/${SLUG}` });
  });

  it("stale cookie minted under a different mode (allowlist→password switch) → unlock", async () => {
    const stale = accessToken({ mode: "allowlist", email: "a@b.com" });
    expect(
      await decideView(buildReport({ verdict: "clean", acl: PW }), {
        cookie: `arp_unlock=${stale}`,
      }),
    ).toEqual({ kind: "redirect", to: `${APP_ORIGIN}/unlock/${SLUG}` });
  });

  it("an EDIT token presented as ?access= does not unlock (cross-token confusion) → unlock", async () => {
    const et = editToken();
    expect(
      await decideView(buildReport({ verdict: "clean", acl: PW }), {
        path: `/${SLUG}?access=${encodeURIComponent(et)}`,
      }),
    ).toEqual({ kind: "redirect", to: `${APP_ORIGIN}/unlock/${SLUG}` });
  });

  it("owner-claim ?access= token → setCookieAndRedirect (grant), regardless of mode", async () => {
    const token = accessToken({ owner: true });
    expect(
      await decideView(buildReport({ verdict: "clean", acl: PRIVATE }), {
        path: `/${SLUG}?access=${encodeURIComponent(token)}`,
      }),
    ).toEqual({
      kind: "setCookieAndRedirect",
      cookies: [`arp_unlock=${token}; Path=/${SLUG}; Max-Age=900; HttpOnly; Secure; SameSite=Lax`],
      to: `/${SLUG}`,
    });
  });

  it("owner-claim cookie → serve, bypassing the allowlist membership/grant checks", async () => {
    const token = accessToken({ owner: true });
    const decision = await decideView(buildReport({ verdict: "clean", acl: ALLOW }), {
      cookie: `arp_unlock=${token}`,
    });
    expect(decision.kind).toBe("serve");
  });

  it("view: an invalid query token FALLS BACK to a valid cookie → serve (unlike edit)", async () => {
    const cookie = accessToken({ mode: "password" });
    const decision = await decideView(buildReport({ verdict: "clean", acl: PW }), {
      path: `/${SLUG}?access=garbage`,
      cookie: `arp_unlock=${cookie}`,
    });
    expect(decision.kind).toBe("serve");
  });

  it("a valid query token takes precedence over a valid cookie → grant (fresh Set-Cookie)", async () => {
    const query = accessToken({ mode: "password" }, 600);
    const cookie = accessToken({ mode: "password" }, 900);
    expect(
      await decideView(buildReport({ verdict: "clean", acl: PW }), {
        path: `/${SLUG}?access=${encodeURIComponent(query)}`,
        cookie: `arp_unlock=${cookie}`,
      }),
    ).toEqual({
      kind: "setCookieAndRedirect",
      cookies: [`arp_unlock=${query}; Path=/${SLUG}; Max-Age=600; HttpOnly; Secure; SameSite=Lax`],
      to: `/${SLUG}`,
    });
  });

  it("public reports serve without consulting tokens (garbage ?access= is ignored)", async () => {
    const decision = await decideView(buildReport({ verdict: "clean", acl: PUBLIC }), {
      path: `/${SLUG}?access=garbage`,
    });
    expect(decision.kind).toBe("serve");
  });
});

describe("decideServe view — allowlist revocation-C (per-request live-grant check)", () => {
  const grantsWithLiveGrant = async () => {
    const grants = new InMemoryGrantStore(new FixedClock(NOW * 1000));
    await grants.grant(RID, "a@b.com", (NOW + 3600) * 1000);
    return grants;
  };

  it("valid token + allowlisted email + live grant → serve", async () => {
    const token = accessToken({ mode: "allowlist", email: "a@b.com" });
    const decision = await decideView(buildReport({ verdict: "clean", acl: ALLOW }), {
      cookie: `arp_unlock=${token}`,
      grants: await grantsWithLiveGrant(),
    });
    expect(decision.kind).toBe("serve");
  });

  it("email no longer on the allowlist → unlock (revoked on the next request)", async () => {
    const token = accessToken({ mode: "allowlist", email: "gone@b.com" });
    expect(
      await decideView(buildReport({ verdict: "clean", acl: ALLOW }), {
        cookie: `arp_unlock=${token}`,
        grants: await grantsWithLiveGrant(),
      }),
    ).toEqual({ kind: "redirect", to: `${APP_ORIGIN}/unlock/${SLUG}` });
  });

  it("allowlisted but no live grant row → unlock (allowlisted ≠ redeemed)", async () => {
    const token = accessToken({ mode: "allowlist", email: "a@b.com" });
    expect(
      await decideView(buildReport({ verdict: "clean", acl: ALLOW }), {
        cookie: `arp_unlock=${token}`,
      }),
    ).toEqual({ kind: "redirect", to: `${APP_ORIGIN}/unlock/${SLUG}` });
  });

  it("grant-store failure → error 500 'Access check failed'", async () => {
    const grants = new InMemoryGrantStore(new FixedClock(NOW * 1000));
    grants.isGranted = async () => err({ kind: "Unexpected", message: "boom" });
    const token = accessToken({ mode: "allowlist", email: "a@b.com" });
    expect(
      await decideView(buildReport({ verdict: "clean", acl: ALLOW }), {
        cookie: `arp_unlock=${token}`,
        grants,
      }),
    ).toEqual({ kind: "error", status: 500, message: "Access check failed" });
  });
});

// ---------------------------------------------------------------------------
// purpose: "view" — interstitial ordering (the M7 / PR #170 regression class):
// the scanning holding page must NEVER be emitted before the ACL gate for a
// non-public mode (eee7cb2's ordering — dogfood 2026-07-08).
// ---------------------------------------------------------------------------
describe("decideServe view — interstitial sits BEHIND the ACL gate", () => {
  it.each<[string, Acl]>([
    ["private", PRIVATE],
    ["password", PW],
    ["org", ORG],
    ["allowlist", ALLOW],
  ])("a %s report mid-scan with no token → unlock redirect, NOT the holding page", async (_n, acl) => {
    expect(await decideView(buildReport({ acl }))).toEqual({
      kind: "redirect",
      to: `${APP_ORIGIN}/unlock/${SLUG}`,
    });
  });

  it("a private report mid-scan WITH an owner cookie → interstitial (authorized holding page)", async () => {
    const token = accessToken({ owner: true });
    expect(
      (
        await decideView(buildReport({ acl: PRIVATE }), {
          cookie: `arp_unlock=${token}`,
        })
      ).kind,
    ).toBe("interstitial");
  });

  it("a password report mid-scan with a valid ?access= → grant (cookie first, then the holding page next request)", async () => {
    const token = accessToken({ mode: "password" });
    expect(
      await decideView(buildReport({ acl: PW }), {
        path: `/${SLUG}?access=${encodeURIComponent(token)}`,
      }),
    ).toEqual({
      kind: "setCookieAndRedirect",
      cookies: [`arp_unlock=${token}; Path=/${SLUG}; Max-Age=900; HttpOnly; Secure; SameSite=Lax`],
      to: `/${SLUG}`,
    });
  });
});

// ---------------------------------------------------------------------------
// purpose: "edit" — the ADR-0063 auth seam (arp_edit cookie + ?et= hand-off +
// the Phase 5-E `oa=` owner degrade).
// ---------------------------------------------------------------------------
describe("decideServe edit — token/cookie decision", () => {
  // The tokenless/invalid-token funnel (grantee-discoverability fix): the app's
  // /reports/{slug}/open is the ONE edit-token mint, so a visitor with no valid
  // capability is sent there instead of being silently degraded to the
  // read-only viewer.
  const OPEN = `${APP_ORIGIN}/reports/${SLUG}/open`;

  it("no token at all → funnel to the app's edit-token mint (/open)", async () => {
    expect(await decideEdit(buildReport({ verdict: "clean" }))).toEqual({
      kind: "redirect",
      to: OPEN,
    });
  });

  it("no token AND no appOrigin → today's degrade to the public viewer (nowhere to funnel)", async () => {
    expect(await decideEdit(buildReport({ verdict: "clean" }), { appOrigin: undefined })).toEqual({
      kind: "redirect",
      to: `/${SLUG}`,
    });
  });

  it("no token AND no secret → today's degrade (a funnel could only loop — no mint validates here)", async () => {
    expect(await decideEdit(buildReport({ verdict: "clean" }), { secret: undefined })).toEqual({
      kind: "redirect",
      to: `/${SLUG}`,
    });
  });

  it("fails closed with no secret, even with a well-formed ?et= → redirect to the public viewer", async () => {
    const et = editToken();
    expect(
      await decideEdit(buildReport({ verdict: "clean" }), {
        path: `/${SLUG}/edit?et=${encodeURIComponent(et)}`,
        secret: undefined,
      }),
    ).toEqual({ kind: "redirect", to: `/${SLUG}` });
  });

  it("valid ?et= → setCookieAndRedirect: arp_edit cookie (Path=/<slug>/edit) + clean URL", async () => {
    const et = editToken();
    expect(
      await decideEdit(buildReport({ verdict: "clean" }), {
        path: `/${SLUG}/edit?et=${encodeURIComponent(et)}`,
      }),
    ).toEqual({
      kind: "setCookieAndRedirect",
      cookies: [`arp_edit=${et}; Path=/${SLUG}/edit; Max-Age=900; HttpOnly; Secure; SameSite=Lax`],
      to: `/${SLUG}/edit`,
    });
  });

  it.each<[string, () => string]>([
    ["expired", () => editToken(900, NOW - 1000)],
    ["malformed", () => "not-a-real-token"],
    ["wrong-slug", () => editToken(900, NOW, OTHER_SLUG)],
  ])("an %s ?et= token → funnel to the app mint (a fresh mint re-admits a writer)", async (_n, tokenOf) => {
    expect(
      await decideEdit(buildReport({ verdict: "clean" }), {
        path: `/${SLUG}/edit?et=${encodeURIComponent(tokenOf())}`,
      }),
    ).toEqual({ kind: "redirect", to: OPEN });
  });

  it("an ACCESS token (even owner:true) presented as ?et= is rejected (cross-parse) → funnel to /open", async () => {
    const owner = accessToken({ owner: true });
    expect(
      await decideEdit(buildReport({ verdict: "clean" }), {
        path: `/${SLUG}/edit?et=${encodeURIComponent(owner)}`,
      }),
    ).toEqual({ kind: "redirect", to: OPEN });
  });

  it("edit: an invalid ?et= does NOT fall back to a valid cookie (unlike view) → funnel to /open", async () => {
    const cookie = editToken();
    expect(
      await decideEdit(buildReport({ verdict: "clean" }), {
        path: `/${SLUG}/edit?et=garbage`,
        cookie: `arp_edit=${cookie}`,
      }),
    ).toEqual({ kind: "redirect", to: OPEN });
  });

  it("a valid ?et= takes precedence over an existing cookie → set-cookie (fresh mint wins)", async () => {
    const fresh = editToken(600);
    const cookie = editToken(900);
    expect(
      await decideEdit(buildReport({ verdict: "clean" }), {
        path: `/${SLUG}/edit?et=${encodeURIComponent(fresh)}`,
        cookie: `arp_edit=${cookie}`,
      }),
    ).toEqual({
      kind: "setCookieAndRedirect",
      cookies: [
        `arp_edit=${fresh}; Path=/${SLUG}/edit; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
      ],
      to: `/${SLUG}/edit`,
    });
  });

  it("valid arp_edit cookie (multi-cookie header) → serve with the edit token + claims", async () => {
    const et = editToken();
    const decision = await decideEdit(buildReport({ verdict: "clean" }), {
      cookie: `foo=bar; arp_edit=${et}; baz=qux`,
    });
    expect(decision.kind).toBe("serve");
    if (decision.kind === "serve") {
      expect(decision.report.id).toBe(RID);
      expect(decision.version.id).toBe(VID);
      expect(decision.edit).toEqual({
        token: et,
        claims: { slug: SLUG, exp: NOW + 900, sub: "user_1", scope: "edit", sessionStart: NOW },
      });
    }
  });

  it("a cookie header WITHOUT an arp_edit entry → funnel to /open (no capability present)", async () => {
    expect(
      await decideEdit(buildReport({ verdict: "clean" }), { cookie: "other=1; another=2" }),
    ).toEqual({ kind: "redirect", to: OPEN });
  });

  it("an empty arp_edit cookie value is treated as absent → funnel to /open", async () => {
    expect(await decideEdit(buildReport({ verdict: "clean" }), { cookie: "arp_edit=" })).toEqual({
      kind: "redirect",
      to: OPEN,
    });
  });

  it("expired arp_edit cookie → funnel to /open (a writer's session seamlessly re-mints)", async () => {
    const et = editToken();
    expect(
      await decideEdit(buildReport({ verdict: "clean" }), {
        cookie: `arp_edit=${et}`,
        now: NOW + 901,
      }),
    ).toEqual({ kind: "redirect", to: OPEN });
  });

  it("the edit gate does NOT consult the report ACL — a private report serves to a valid edit cookie", async () => {
    const et = editToken();
    const decision = await decideEdit(buildReport({ verdict: "clean", acl: PRIVATE }), {
      cookie: `arp_edit=${et}`,
    });
    expect(decision.kind).toBe("serve");
  });

  it("the edit gate ignores ?v= — always the live version", async () => {
    const et = editToken();
    const decision = await decideEdit(buildMultiVersionReport(PUBLIC), {
      path: `/${SLUG}/edit?v=3`,
      cookie: `arp_edit=${et}`,
    });
    expect(decision.kind).toBe("serve");
    if (decision.kind === "serve") expect(decision.version.id).toBe(VID);
  });
});

describe("decideServe edit — degrade paths for a valid capability", () => {
  const withCookie = { cookie: `arp_edit=${mintEditToken(SLUG, "user_1", 900, SECRET, NOW)}` };

  // Destination AND log line in ONE assertion per case. They were two separate
  // it.each blocks over the same fixtures and the same call, and the second one
  // silently covered three of the first one's five cases — so "missing report"
  // and "blocked" had their redirect asserted but never their warn.
  //
  // OBSERVABILITY (the 2026-08-06 owner-lockout incident): EVERY degrade off
  // /edit must leave a log line. Before the fix only the `oa`-carrying denied
  // branch warned, so a real owner lockout produced a 302 with ZERO signal on
  // the view origin — the incident was only inferable from the user report.
  it.each<[string, () => Report | undefined, string]>([
    ["missing report", () => undefined, "no-servable-version"],
    ["scanning (no clean live)", () => buildReport(), "no-servable-version"],
    ["flagged", () => buildReport({ verdict: "flagged" }), "no-servable-version"],
    ["blocked", () => buildReport({ verdict: "blocked" }), "no-servable-version"],
    ["deleted", () => buildReport({ verdict: "clean", deleted: true }), "no-servable-version"],
  ])("%s → redirect to the public viewer, with one edit-degraded-to-view line", async (_n, reportOf, reason) => {
    const warn = vi.fn();
    expect(await decideEdit(reportOf(), { ...withCookie, warn })).toEqual({
      kind: "redirect",
      to: `/${SLUG}`,
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(warn.mock.calls[0]?.[0] as string)).toEqual({
      event: "edit-degraded-to-view",
      slug: SLUG,
      reason,
    });
  });

  it("repository failure → redirect, warned with its OWN reason (not merged into no-version)", async () => {
    const warn = vi.fn();
    expect(await decideEdit(undefined, { ...withCookie, reports: failingRepo, warn })).toEqual({
      kind: "redirect",
      to: `/${SLUG}`,
    });
    expect(JSON.parse(warn.mock.calls[0]?.[0] as string)).toEqual({
      event: "edit-degraded-to-view",
      slug: SLUG,
      reason: "lookup-failed",
    });
  });

  it("no appOrigin → redirect (never render the editor without a Save target), warned", async () => {
    const warn = vi.fn();
    expect(
      await decideEdit(buildReport({ verdict: "clean" }), {
        ...withCookie,
        appOrigin: undefined,
        warn,
      }),
    ).toEqual({ kind: "redirect", to: `/${SLUG}` });
    expect(JSON.parse(warn.mock.calls[0]?.[0] as string)).toEqual({
      event: "edit-degraded-to-view",
      slug: SLUG,
      reason: "app-origin-unset",
    });
  });
});

describe("decideServe edit — the `oa=` owner-access degrade hand-off (Phase 5-E)", () => {
  // REORDERED 2026-08-06. `deniedEdit` used to answer `if (oa)` BEFORE the
  // funnel, so an owner holding a fallback ALWAYS went to read-only. That was
  // safe while `oa` could only arrive on a query — it was present exactly once,
  // on the request that had just been minted. Now that it is cookie-carried,
  // an `arp_edit` that is REJECTED rather than absent (secret rotation,
  // tampering, clock skew) hits the same branch and sends the owner to
  // read-only instead of back through the mint that would have fixed them —
  // removing the recovery path in precisely the secret-rotation scenario Phase
  // 5-E exists for. A REJECTION now funnels first; the `oa` degrade is what
  // happens when the funnel itself is unavailable.
  it("REJECTED token + oa present → funnel to the mint, which is what can fix it", async () => {
    const oa = ownerAccess();
    const warn = vi.fn();
    expect(
      await decideEdit(buildReport({ verdict: "clean" }), {
        path: `/${SLUG}/edit?et=garbage&oa=${encodeURIComponent(oa)}`,
        warn,
      }),
    ).toEqual({ kind: "redirect", to: `${APP_ORIGIN}/reports/${SLUG}/open` });
    // The funnel is the happy path for a writer whose token simply needs
    // re-minting — not a degrade, so nothing to warn about.
    expect(warn).not.toHaveBeenCalled();
  });

  it("REJECTED token + oa, but NO appOrigin → the oa degrade (there is no mint to funnel to)", async () => {
    const oa = ownerAccess();
    const warn = vi.fn();
    expect(
      await decideEdit(buildReport({ verdict: "clean" }), {
        path: `/${SLUG}/edit?et=garbage&oa=${encodeURIComponent(oa)}`,
        appOrigin: undefined,
        warn,
      }),
    ).toEqual({ kind: "redirect", to: `/${SLUG}?access=${encodeURIComponent(oa)}` });
    expect(JSON.parse(warn.mock.calls[0]?.[0] as string)).toEqual({
      event: "owner-edit-degraded-to-view",
      slug: SLUG,
      reason: "edit-token-denied",
    });
  });

  // ABSENCE is the other cause, and it keeps the old order: there was no token
  // to reject, so nothing suggests the mint round-trip is what broke, and the
  // verified `oa` in hand is a WORKING capability for the read-only view.
  it("ABSENT token + oa present → the oa degrade (unchanged — nothing was rejected)", async () => {
    const oa = ownerAccess();
    const warn = vi.fn();
    expect(
      await decideEdit(buildReport({ verdict: "clean" }), {
        cookie: `arp_edit_oa=${encodeURIComponent(oa)}`,
        warn,
      }),
    ).toEqual({ kind: "redirect", to: `/${SLUG}?access=${encodeURIComponent(oa)}` });
    expect(JSON.parse(warn.mock.calls[0]?.[0] as string)).toEqual({
      event: "owner-edit-degraded-to-view",
      slug: SLUG,
      reason: "edit-token-denied",
    });
  });

  it("denied WITHOUT oa → funnel to the app mint, and no degrade warning", async () => {
    const warn = vi.fn();
    expect(
      await decideEdit(buildReport({ verdict: "clean" }), {
        path: `/${SLUG}/edit?et=garbage`,
        warn,
      }),
    ).toEqual({ kind: "redirect", to: `${APP_ORIGIN}/reports/${SLUG}/open` });
    expect(warn).not.toHaveBeenCalled();
  });

  it("a valid ?et= ALSO persists oa as its own cookie (it must survive the 303's query strip)", async () => {
    const et = editToken();
    const oa = ownerAccess();
    const warn = vi.fn();
    expect(
      await decideEdit(buildReport({ verdict: "clean" }), {
        path: `/${SLUG}/edit?et=${encodeURIComponent(et)}&oa=${encodeURIComponent(oa)}`,
        warn,
      }),
    ).toEqual({
      kind: "setCookieAndRedirect",
      cookies: [
        `arp_edit=${et}; Path=/${SLUG}/edit; Max-Age=900; HttpOnly; Secure; SameSite=Lax`,
        `arp_edit_oa=${encodeURIComponent(oa)}; Path=/${SLUG}/edit; Max-Age=900; HttpOnly; Secure; SameSite=Lax`,
      ],
      to: `/${SLUG}/edit`,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  // NOTE: "a valid ?et= with NO oa sets only the edit cookie (a write-grantee
  // has no fallback)" used to live here as a byte-identical copy of the
  // "valid ?et= → setCookieAndRedirect" case above — same token, same expected
  // `cookies` array. Deleted; the surviving one covers it.
});

// ---------------------------------------------------------------------------
// THE 2026-08-06 OWNER-LOCKOUT REGRESSION GUARD.
//
// An owner's round-trip is TWO requests: `?et=…&oa=…` → 303 (query stripped,
// arp_edit cookie set) → the clean `/slug/edit` carrying only cookies. Every
// degrade that fires on that SECOND request had no `oa` in hand — it was
// delivered once, on the query, and thrown away by the 303 — so it sent a
// PRIVATE report's owner to the bare public viewer, which 302s them to the
// app's /unlock/{slug}, which 403s "only its owner can view it". The owner is
// locked out of their own report, silently.
//
// The fix: `oa` is persisted as its own scoped cookie at 303 time and is read
// back on the cookie request, so EVERY degrade — not just the denied branch —
// routes an owner through the viewer's `?access=` flow.
// ---------------------------------------------------------------------------
describe("decideServe edit — the owner fallback survives the 303 (cookie-carried oa)", () => {
  const OA = ownerAccess();
  const cookiesWith = (et: string, oa = OA) =>
    `arp_edit=${et}; arp_edit_oa=${encodeURIComponent(oa)}`;

  it.each<[string, () => Report | undefined, string]>([
    ["missing report", () => undefined, "no-servable-version"],
    ["scanning (no clean live)", () => buildReport(), "no-servable-version"],
    ["flagged", () => buildReport({ verdict: "flagged" }), "no-servable-version"],
    ["blocked", () => buildReport({ verdict: "blocked" }), "no-servable-version"],
    ["deleted", () => buildReport({ verdict: "clean", deleted: true }), "no-servable-version"],
  ])("%s on the cookie request → the OWNER degrades through ?access=, not to the unlock wall", async (_n, reportOf, reason) => {
    const warn = vi.fn();
    expect(await decideEdit(reportOf(), { cookie: cookiesWith(editToken()), warn })).toEqual({
      kind: "redirect",
      to: `/${SLUG}?access=${encodeURIComponent(OA)}`,
    });
    expect(JSON.parse(warn.mock.calls[0]?.[0] as string)).toEqual({
      event: "owner-edit-degraded-to-view",
      slug: SLUG,
      reason,
    });
  });

  it("no appOrigin on the cookie request → the owner still degrades through ?access=", async () => {
    const warn = vi.fn();
    expect(
      await decideEdit(buildReport({ verdict: "clean" }), {
        cookie: cookiesWith(editToken()),
        appOrigin: undefined,
        warn,
      }),
    ).toEqual({ kind: "redirect", to: `/${SLUG}?access=${encodeURIComponent(OA)}` });
    expect(JSON.parse(warn.mock.calls[0]?.[0] as string)).toEqual({
      event: "owner-edit-degraded-to-view",
      slug: SLUG,
      reason: "app-origin-unset",
    });
  });

  // An EXPIRED `arp_edit` is a REJECTION, not an absence — a token was
  // presented and did not verify — so it funnels rather than degrading. This
  // is the case the reorder is really for: the owner's cookie has aged out (or
  // the secret rotated under it), and the mint is what restores them. Degrading
  // here would drop a still-entitled owner into read-only for the rest of the
  // fallback's 24h life, with no way back except guessing at the dashboard.
  it("an EXPIRED arp_edit cookie alongside the oa cookie funnels to the mint, not to read-only", async () => {
    const warn = vi.fn();
    expect(
      await decideEdit(buildReport({ verdict: "clean" }), {
        cookie: cookiesWith(editToken()),
        now: NOW + 901,
        warn,
      }),
    ).toEqual({ kind: "redirect", to: `${APP_ORIGIN}/reports/${SLUG}/open` });
    expect(warn).not.toHaveBeenCalled();
  });

  // …but the unlock wall still has to be unreachable when the funnel is gone.
  it("an EXPIRED arp_edit cookie with NO appOrigin still degrades the owner through ?access=", async () => {
    const warn = vi.fn();
    expect(
      await decideEdit(buildReport({ verdict: "clean" }), {
        cookie: cookiesWith(editToken()),
        now: NOW + 901,
        appOrigin: undefined,
        warn,
      }),
    ).toEqual({ kind: "redirect", to: `/${SLUG}?access=${encodeURIComponent(OA)}` });
    expect(JSON.parse(warn.mock.calls[0]?.[0] as string)).toEqual({
      event: "owner-edit-degraded-to-view",
      slug: SLUG,
      reason: "edit-token-denied",
    });
  });

  // The route's OWN post-gate degrades (the blob read / the shell split — the
  // two lines that actually fired in the incident) need the same destination,
  // and they only ever see the Decision. So `serve` carries it.
  it("a served editor carries the owner degrade target for the route's post-gate failures", async () => {
    const decision = await decideEdit(buildReport({ verdict: "clean" }), {
      cookie: cookiesWith(editToken()),
    });
    expect(decision.kind).toBe("serve");
    if (decision.kind === "serve") {
      expect(decision.degradeTo).toBe(`/${SLUG}?access=${encodeURIComponent(OA)}`);
      expect(decision.ownerFallback).toBe(true);
    }
  });

  it("a served editor WITHOUT an owner fallback degrades to the bare viewer (grantee — unchanged)", async () => {
    const decision = await decideEdit(buildReport({ verdict: "clean" }), {
      cookie: `arp_edit=${editToken()}`,
    });
    expect(decision.kind).toBe("serve");
    if (decision.kind === "serve") {
      expect(decision.degradeTo).toBe(`/${SLUG}`);
      expect(decision.ownerFallback).toBe(false);
    }
  });

  // NOTE: "an empty arp_edit_oa cookie is treated as absent" used to live here.
  // It PASSED against `main` — where nothing reads `arp_edit_oa` at all — so it
  // could not distinguish "treated as absent" from "never read", and it is now
  // subsumed by the rejection matrix below (an empty value is just one more
  // value that doesn't verify as an owner token).

  it("a query oa= still wins over a stale cookie oa (a fresh mint always supersedes)", async () => {
    const fresh = ownerAccess(3600);
    const decision = await decideEdit(buildReport({ verdict: "clean" }), {
      path: `/${SLUG}/edit?oa=${encodeURIComponent(fresh)}`,
      cookie: cookiesWith(editToken(), ownerAccess(900)),
    });
    expect(decision.kind).toBe("serve");
    if (decision.kind === "serve") {
      expect(decision.degradeTo).toBe(`/${SLUG}?access=${encodeURIComponent(fresh)}`);
    }
  });
});

// ---------------------------------------------------------------------------
// THE OWNER FALLBACK IS VERIFIED, NOT TRUSTED (review #247 H-1).
//
// `oa` used to be taken straight off the query, written verbatim into a
// Set-Cookie, and used as `ownerFallback: oa !== undefined` — the flag that
// selects the `owner-edit-degraded-to-view` event. So ANY visitor holding a
// valid `et=` (a write-grantee, for whom `ownerOpenLocation` deliberately never
// mints an `oa`) could append `&oa=anything` and forge the exact incident
// signal this PR exists to create, and park unbounded bytes in the cookie jar.
// No privilege escalation — redemption is verified downstream by
// resolveAccessDecision — but an untrustworthy signal is worse than no signal.
//
// The gate now honors `oa` only when it verifies as an owner Access token FOR
// THIS SLUG: correct HMAC, unexpired, `owner === true`, and within a length cap.
// ---------------------------------------------------------------------------
describe("decideServe edit — an unverified oa= is not an owner fallback", () => {
  const forged = [
    ["arbitrary text", () => "owner.token.with/special+chars"],
    ["an empty value", () => ""],
    ["a non-owner access token (mode-bound)", () => accessToken({ mode: "password" })],
    ["an owner token for ANOTHER slug", () => ownerAccess(900, NOW, OTHER_SLUG)],
    ["an EXPIRED owner token", () => ownerAccess(900, NOW - 1000)],
    ["an edit token presented as oa", () => editToken()],
    ["a token over the length cap", () => `${ownerAccess()}${"A".repeat(4096)}`],
  ] as const;

  it.each(
    forged,
  )("%s on ?et=garbage → the app mint funnel, NOT an owner degrade", async (_n, oaOf) => {
    const warn = vi.fn();
    expect(
      await decideEdit(buildReport({ verdict: "clean" }), {
        path: `/${SLUG}/edit?et=garbage&oa=${encodeURIComponent(oaOf())}`,
        warn,
      }),
    ).toEqual({ kind: "redirect", to: `${APP_ORIGIN}/reports/${SLUG}/open` });
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(forged)("%s is never persisted into arp_edit_oa on the 303", async (_n, oaOf) => {
    const et = editToken();
    expect(
      await decideEdit(buildReport({ verdict: "clean" }), {
        path: `/${SLUG}/edit?et=${encodeURIComponent(et)}&oa=${encodeURIComponent(oaOf())}`,
      }),
    ).toEqual({
      kind: "setCookieAndRedirect",
      cookies: [`arp_edit=${et}; Path=/${SLUG}/edit; Max-Age=900; HttpOnly; Secure; SameSite=Lax`],
      to: `/${SLUG}/edit`,
    });
  });

  it.each(forged)("%s in the cookie cannot forge the owner incident signal", async (_n, oaOf) => {
    const warn = vi.fn();
    expect(
      await decideEdit(buildReport(), {
        cookie: `arp_edit=${editToken()}; arp_edit_oa=${encodeURIComponent(oaOf())}`,
        warn,
      }),
    ).toEqual({ kind: "redirect", to: `/${SLUG}` });
    expect(JSON.parse(warn.mock.calls[0]?.[0] as string)).toEqual({
      event: "edit-degraded-to-view", // NOT owner-…
      slug: SLUG,
      reason: "no-servable-version",
    });
  });

  it("with no secret configured, even a genuine oa is not honored (fail closed)", async () => {
    const warn = vi.fn();
    expect(
      await decideEdit(buildReport({ verdict: "clean" }), {
        path: `/${SLUG}/edit?et=garbage&oa=${encodeURIComponent(ownerAccess())}`,
        secret: undefined,
        warn,
      }),
    ).toEqual({ kind: "redirect", to: `/${SLUG}` });
    expect(JSON.parse(warn.mock.calls[0]?.[0] as string)).toEqual({
      event: "edit-degraded-to-view",
      slug: SLUG,
      reason: "edit-token-denied",
    });
  });
});

// ---------------------------------------------------------------------------
// degradeTargetFor — the ONE place a route asks "if I can't render, where do I
// send them, and is this an owner?". The /edit route had TWO answers: it read
// `decision.degradeTo` for its document-load failures but hard-coded
// `/${params.slug}` in its defensive-narrowing branch (review #247 M-2) — the
// same "one branch left untouched" shape ADR-0063 criticises Phase 5-E for.
// ---------------------------------------------------------------------------
describe("degradeTargetFor", () => {
  it("a served editor with an owner fallback → the ?access= target, flagged as owner", async () => {
    const oa = ownerAccess();
    const decision = await decideEdit(buildReport({ verdict: "clean" }), {
      cookie: `arp_edit=${editToken()}; arp_edit_oa=${encodeURIComponent(oa)}`,
    });
    expect(degradeTargetFor(decision, SLUG)).toEqual({
      to: `/${SLUG}?access=${encodeURIComponent(oa)}`,
      ownerFallback: true,
    });
  });

  it("a served editor without one → the bare viewer, not flagged", async () => {
    const decision = await decideEdit(buildReport({ verdict: "clean" }), {
      cookie: `arp_edit=${editToken()}`,
    });
    expect(degradeTargetFor(decision, SLUG)).toEqual({ to: `/${SLUG}`, ownerFallback: false });
  });

  // The decision kinds the edit purpose cannot produce, but whose types the
  // route still has to narrow past — the branch that used to answer silently.
  it.each<[string, Decision]>([
    ["interstitial", { kind: "interstitial" }],
    ["error", { kind: "error", status: 404, message: "Not found" }],
    ["redirect", { kind: "redirect", to: "/elsewhere" }],
    ["setCookieAndRedirect", { kind: "setCookieAndRedirect", cookies: [], to: "/x" }],
  ])("%s → the bare viewer for this slug, not flagged", (_n, decision) => {
    expect(degradeTargetFor(decision, SLUG)).toEqual({ to: `/${SLUG}`, ownerFallback: false });
  });
});
