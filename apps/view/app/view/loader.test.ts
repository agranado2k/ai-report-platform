// ROUTE-level tests for `GET /<slug>/view` — the composed loader, not just the
// gate. The gate's decision matrix is pinned in `server/gate.server.test.ts`;
// what only a route test can hold honest is what this loader turns each
// Decision INTO: the status, the Location, the Set-Cookie list, and — the
// acceptance criterion the 2026-09-09 spike produced — the header stack.
//
// They live under `app/view/` rather than `app/routes/` on purpose: any file
// in the Remix flat-routes directory becomes a ROUTE.
import {
  FixedClock,
  InMemoryGrantStore,
  InMemoryOrgWriteGrantStore,
  InMemoryReportRepository,
} from "arp-application/testing";
import {
  type Acl,
  applyScanResult,
  createReport,
  folderId,
  makeSlug,
  mintAccessToken,
  mintEditToken,
  orgId,
  type Report,
  reportId,
  userId,
  versionId,
} from "arp-domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SLUG = "abcde12345";
const SECRET = "view-access-secret";
const APP_ORIGIN = "https://app.example.test";
const NOW = 1_700_000_000;

const state = vi.hoisted(() => ({
  reports: null as unknown as InMemoryReportRepository,
  orgWriteGrants: null as unknown as InMemoryOrgWriteGrantStore,
  appOrigin: undefined as string | undefined,
  secret: undefined as string | undefined,
  // The seam for the loader's DEFENSIVE `!appOrigin` branch. The gate never
  // returns "serve" with `appOrigin` unset — it degrades those itself — so
  // that branch is unreachable through the real gate, and the only way to
  // exercise it is to force the pathological Decision the loader is written
  // to survive. `null` means "use the real gate", which is what every other
  // test in this file does.
  forcedDecision: null as unknown,
}));

vi.mock("../server/gate.server", async (importOriginal) => {
  const real = await importOriginal<typeof import("../server/gate.server")>();
  return {
    ...real,
    decideServe: async (...args: Parameters<typeof real.decideServe>) =>
      state.forcedDecision ?? real.decideServe(...(args as Parameters<typeof real.decideServe>)),
  };
});

vi.mock("../server/container.server", () => ({
  viewerAccessConfig: () => ({ secret: state.secret, appOrigin: state.appOrigin }),
  viewerDeps: () => ({
    reports: state.reports,
    grants: new InMemoryGrantStore(new FixedClock(NOW * 1000)),
    // The owner view reads this to tell "the org can READ it" from "the org
    // can EDIT it" (ADR-0078) — `Acl` mode `org` alone cannot. Empty by
    // default, so a report in `org` mode reads as "Org"; the test that cares
    // grants a row first.
    orgWriteGrants: state.orgWriteGrants,
    blobs: { readObject: async () => ({ ok: true as const, value: null }) },
  }),
}));

const { loader } = await import("../routes/$slug_.view");

function buildReport(acl: Acl = { mode: "private" }): Report {
  const slug = makeSlug(SLUG);
  if (!slug.ok) throw new Error("bad test slug");
  const { report } = createReport({
    id: reportId("00000000-0000-4000-8000-0000000000a1"),
    orgId: orgId("00000000-0000-4000-8000-000000000001"),
    folderId: folderId("00000000-0000-4000-8000-000000000003"),
    slug: slug.value,
    title: "Quarterly deck",
    versionId: versionId("00000000-0000-4000-8000-0000000000b1"),
    contentHash: "a".repeat(64),
    uploadedBy: userId("00000000-0000-4000-8000-000000000002"),
    manifest: { entryDocument: "index.html", files: ["index.html"] },
    sizeBytes: 11,
  });
  const clean = applyScanResult(report, versionId("00000000-0000-4000-8000-0000000000b1"), "clean");
  return { ...clean.report, acl };
}

async function get(path: string, cookie?: string): Promise<Response> {
  vi.setSystemTime(NOW * 1000);
  const request = new Request(`https://view.example.test${path}`, {
    headers: cookie ? { cookie } : undefined,
  });
  const result = await loader({ request, params: { slug: SLUG }, context: {} } as never);
  return result instanceof Response ? result : (result as { init?: never } & Response);
}

const editToken = () => mintEditToken(SLUG, "user_1", 900, SECRET, NOW);
const ownerAccess = () => mintAccessToken(SLUG, 86_400, SECRET, NOW, { owner: true });

afterEach(() => {
  // Fake timers leak across FILES in a shared environment; a suite that never
  // restores them makes an unrelated failure elsewhere look like a flake.
  vi.useRealTimers();
});

beforeEach(async () => {
  vi.useFakeTimers();
  state.forcedDecision = null;
  state.reports = new InMemoryReportRepository();
  state.orgWriteGrants = new InMemoryOrgWriteGrantStore();
  state.appOrigin = APP_ORIGIN;
  state.secret = SECRET;
  await state.reports.save(buildReport());
});

describe("GET /<slug>/view — the `?et=` hand-off", () => {
  it("303s to the clean URL and appends EVERY cookie (never `set`)", async () => {
    const res = await get(
      `/${SLUG}/view?et=${encodeURIComponent(editToken())}&oa=${encodeURIComponent(ownerAccess())}`,
    );

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/${SLUG}/view`);
    // getSetCookie() is the only way to see that the loader APPENDED rather
    // than overwrote — `set` would silently collapse three capabilities into
    // the last one, which is how a frame ends up at the unlock wall.
    expect(res.headers.getSetCookie()).toHaveLength(3);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });
});

describe("GET /<slug>/view — the header stack (ADR-0089 §5)", () => {
  it("sends Origin-Agent-Cluster so the origin is UNIFORMLY origin-keyed", async () => {
    // The spike's surprise (a): Chromium warned that the chrome page was
    // site-keyed while the framed report requested `Origin-Agent-Cluster: ?1`.
    // Both documents on this origin must agree or the keying is not uniform.
    const res = await get(`/${SLUG}/view`, `arp_view=${editToken()}`);
    expect(res.headers.get("Origin-Agent-Cluster")).toBe("?1");
  });

  it("may frame its own origin, and may not be framed by anything", async () => {
    const res = await get(`/${SLUG}/view`, `arp_view=${editToken()}`);
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("frame-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("carries NO top-level sandbox CSP — that header is for the REPORT, not the chrome", async () => {
    // `viewHeaders()` appends a second, `sandbox`-directive CSP that drops the
    // document into an opaque origin. Correct for untrusted report bytes on
    // `GET /<slug>`; fatal here, where the document is our own first-party UI.
    const res = await get(`/${SLUG}/view`, `arp_view=${editToken()}`);
    expect(res.headers.get("Content-Security-Policy")).not.toContain("sandbox");
  });

  it("is never cached and never indexed", async () => {
    const res = await get(`/${SLUG}/view`, `arp_view=${editToken()}`);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });
});

describe("GET /<slug>/view — denial", () => {
  it("funnels an anonymous visitor to the app's mint, leaking no existence", async () => {
    const res = await get(`/${SLUG}/view`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${APP_ORIGIN}/reports/${SLUG}/open`);
  });

  it("answers a NONEXISTENT report identically", async () => {
    state.reports = new InMemoryReportRepository();
    state.orgWriteGrants = new InMemoryOrgWriteGrantStore();
    const res = await get(`/${SLUG}/view`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${APP_ORIGIN}/reports/${SLUG}/open`);
  });

  it("404s an invalid slug", async () => {
    const request = new Request("https://view.example.test/nope/view");
    await expect(
      loader({ request, params: { slug: "nope" }, context: {} } as never),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("GET /<slug>/view — the loader payload", () => {
  it("hands the client NO capability — this route has no cross-origin data plane", async () => {
    // ADR-0089 §6, and the sharpest contrast with /edit: the editor
    // deliberately hydrates its edit token so client JS can Bearer it at the
    // app-origin API. The owner view calls nothing, so it carries nothing —
    // its capability stays in HttpOnly cookies the page's own JS cannot read.
    const res = await get(`/${SLUG}/view`, `arp_view=${editToken()}`);
    const body = await res.text();
    expect(body).not.toContain(editToken());
    expect(body).not.toMatch(/"(editToken|token|oa|access)"\s*:/);
  });

  it("offers Edit to a write capability", async () => {
    const res = await get(`/${SLUG}/view`, `arp_view=${editToken()}`);
    expect(JSON.parse(await res.text()).canEdit).toBe(true);
  });

  it("withholds Edit on the owner-read degrade", async () => {
    // Split from the case above deliberately: as one `it` a failure named
    // neither capability, and the read-only half never ran at all if the
    // write half failed first.
    const res = await get(`/${SLUG}/view`, `arp_view_oa=${encodeURIComponent(ownerAccess())}`);
    expect(JSON.parse(await res.text()).canEdit).toBe(false);
  });

  it("re-issues the frame's unlock cookie on the read-only serve", async () => {
    // The gate decides it (ADR-0089 §3/§4c); what only a route test can hold
    // honest is that the 200 response actually CARRIES it — a `serve` arm that
    // grew a cookie the loader never applied would leave the frame at the
    // unlock wall with a fully green decision matrix.
    const res = await get(`/${SLUG}/view`, `arp_view_oa=${encodeURIComponent(ownerAccess())}`);

    expect(res.status).toBe(200);
    const cookies = res.headers.getSetCookie();
    expect(cookies).toEqual([
      `arp_unlock=${ownerAccess()}; Path=/${SLUG}; Max-Age=86400; HttpOnly; Secure; SameSite=Lax`,
    ]);
  });

  it("sets no cookie at all when there is no `oa` to redeem", async () => {
    const res = await get(`/${SLUG}/view`, `arp_view=${editToken()}`);

    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("distinguishes an org report the org can READ from one it can EDIT", async () => {
    // The reason the owner view needs the org write grant at all, and the
    // reason `Acl` mode alone was not enough: `org` answers "who can see it?"
    // but not "who can change it?", and only one of those is worth an owner's
    // alarm. Same copy the dashboard's badge renders, from the same domain
    // function (ADR-0078) — the two surfaces cannot disagree.
    await state.reports.save(buildReport({ mode: "org" }));

    const readOnly = await get(`/${SLUG}/view`, `arp_view=${editToken()}`);
    expect(JSON.parse(await readOnly.text()).shareState).toBe("Org");

    await state.orgWriteGrants.grant(
      reportId("00000000-0000-4000-8000-0000000000a1"),
      orgId("00000000-0000-4000-8000-000000000001"),
      userId("00000000-0000-4000-8000-000000000002"),
    );

    const orgEdit = await get(`/${SLUG}/view`, `arp_view=${editToken()}`);
    expect(JSON.parse(await orgEdit.text()).shareState).toBe("Org + edit");
  });

  it("renders a share state even when the org-write lookup fails", async () => {
    // A badge that cannot be computed must not cost an owner their report. It
    // degrades to the read-only claim, which UNDERSTATES a grant rather than
    // inventing one, and leaves a line so the failure is visible in the logs.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await state.reports.save(buildReport({ mode: "org" }));
    state.orgWriteGrants.find = async () => ({
      ok: false as const,
      error: { kind: "Unexpected" as const, message: "org write lookup exploded" },
    });

    const res = await get(`/${SLUG}/view`, `arp_view=${editToken()}`);

    expect(res.status).toBe(200);
    expect(JSON.parse(await res.text()).shareState).toBe("Org");
    expect(String(warn.mock.calls[0]?.[0])).toContain("owner-view-org-write-lookup-failed");
    warn.mockRestore();
  });

  it("carries the report title, its slug and its share state", async () => {
    const res = await get(`/${SLUG}/view`, `arp_view=${editToken()}`);
    const data = JSON.parse(await res.text());

    expect(data.docTitle).toBe("Quarterly deck");
    expect(data.slug).toBe(SLUG);
    // The chrome's share-state label is report-derived and user-facing: the
    // failure mode of getting it wrong is telling an owner that a PRIVATE
    // report is public. `share-state.test.ts` pins the whole AclMode map;
    // this pins that the loader reads the report's OWN mode to build it.
    expect(data.shareState).toBe("Private");
  });
});

describe("GET /<slug>/view — the loader's defensive `!appOrigin` narrowing", () => {
  it("degrades through the gate's own target and leaves a line, rather than stranding an owner", async () => {
    // Unreachable through the real gate — it degrades an unset `appOrigin`
    // itself — so this forces the pathological Decision the branch exists to
    // survive. It is not dead code: `appOrigin` is the ROUTE's own local (its
    // header profile needs it for `connect-src`), read independently of the
    // Decision, so the two can only be kept in agreement by the gate. If they
    // ever disagree, this is the difference between an owner degrading with a
    // log line and `editViewHeaders(undefined)` failing open.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    state.appOrigin = undefined;
    state.forcedDecision = {
      kind: "serve",
      report: buildReport(),
      version: {},
      capability: "ownerRead",
      cookies: [],
      degradeTo: `/${SLUG}?access=owner-token`,
      ownerFallback: true,
    };

    const res = await get(`/${SLUG}/view`);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/${SLUG}?access=owner-token`);
    // The owner-specific event name is what makes this visible in an incident
    // query rather than only inferable from user reports.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("owner-view-owner-degraded-to-view");
    expect(String(warn.mock.calls[0]?.[0])).toContain("gate-decision-unusable");

    warn.mockRestore();
  });
});
