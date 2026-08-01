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
import { type Decision, decideServe, type GateDeps } from "./gate.server";

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
      cookie: `arp_unlock=${token}; Path=/${SLUG}; Max-Age=900; HttpOnly; Secure; SameSite=Lax`,
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
      cookie: `arp_unlock=${token}; Path=/${SLUG}; Max-Age=900; HttpOnly; Secure; SameSite=Lax`,
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
      cookie: `arp_unlock=${query}; Path=/${SLUG}; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
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
      cookie: `arp_unlock=${token}; Path=/${SLUG}; Max-Age=900; HttpOnly; Secure; SameSite=Lax`,
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
      cookie: `arp_edit=${et}; Path=/${SLUG}/edit; Max-Age=900; HttpOnly; Secure; SameSite=Lax`,
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
      cookie: `arp_edit=${fresh}; Path=/${SLUG}/edit; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
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

  it("no appOrigin configured → redirect (never render the editor without a Save target)", async () => {
    expect(
      await decideEdit(buildReport({ verdict: "clean" }), { ...withCookie, appOrigin: undefined }),
    ).toEqual({ kind: "redirect", to: `/${SLUG}` });
  });

  it.each<[string, () => Report | undefined]>([
    ["missing report", () => undefined],
    ["scanning (no clean live)", () => buildReport()],
    ["flagged", () => buildReport({ verdict: "flagged" })],
    ["blocked", () => buildReport({ verdict: "blocked" })],
    ["deleted", () => buildReport({ verdict: "clean", deleted: true })],
  ])("%s → redirect to the public viewer (it owns that state machine)", async (_n, reportOf) => {
    expect(await decideEdit(reportOf(), withCookie)).toEqual({
      kind: "redirect",
      to: `/${SLUG}`,
    });
  });

  it("repository failure → redirect (degrade, not 500 — the edit route never errors)", async () => {
    expect(await decideEdit(undefined, { ...withCookie, reports: failingRepo })).toEqual({
      kind: "redirect",
      to: `/${SLUG}`,
    });
  });
});

describe("decideServe edit — the `oa=` owner-access degrade hand-off (Phase 5-E)", () => {
  it("denied + oa present → redirect through the viewer's ?access= owner flow, URL-encoded", async () => {
    const oa = "owner.token.with/special+chars";
    const warn = vi.fn();
    expect(
      await decideEdit(buildReport({ verdict: "clean" }), {
        path: `/${SLUG}/edit?et=garbage&oa=${encodeURIComponent(oa)}`,
        warn,
      }),
    ).toEqual({ kind: "redirect", to: `/${SLUG}?access=${encodeURIComponent(oa)}` });
    expect(warn).toHaveBeenCalledTimes(1);
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

  it("oa is IGNORED when the edit token is valid (only the denied branch consults it)", async () => {
    const et = editToken();
    const warn = vi.fn();
    expect(
      await decideEdit(buildReport({ verdict: "clean" }), {
        path: `/${SLUG}/edit?et=${encodeURIComponent(et)}&oa=some-owner-token`,
        warn,
      }),
    ).toEqual({
      kind: "setCookieAndRedirect",
      cookie: `arp_edit=${et}; Path=/${SLUG}/edit; Max-Age=900; HttpOnly; Secure; SameSite=Lax`,
      to: `/${SLUG}/edit`,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("oa does NOT rescue a post-auth degrade (missing appOrigin) — only the denied branch", async () => {
    const et = editToken();
    expect(
      await decideEdit(buildReport({ verdict: "clean" }), {
        path: `/${SLUG}/edit?oa=some-owner-token`,
        cookie: `arp_edit=${et}`,
        appOrigin: undefined,
      }),
    ).toEqual({ kind: "redirect", to: `/${SLUG}` });
  });
});
