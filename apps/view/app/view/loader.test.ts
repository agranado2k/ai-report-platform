// ROUTE-level tests for `GET /<slug>/view` — the composed loader, not just the
// gate. The gate's decision matrix is pinned in `server/gate.server.test.ts`;
// what only a route test can hold honest is what this loader turns each
// Decision INTO: the status, the Location, the Set-Cookie list, and — the
// acceptance criterion the 2026-09-09 spike produced — the header stack.
//
// They live under `app/view/` rather than `app/routes/` on purpose: any file
// in the Remix flat-routes directory becomes a ROUTE.
import { FixedClock, InMemoryGrantStore, InMemoryReportRepository } from "arp-application/testing";
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
import { beforeEach, describe, expect, it, vi } from "vitest";

const SLUG = "abcde12345";
const SECRET = "view-access-secret";
const APP_ORIGIN = "https://app.example.test";
const NOW = 1_700_000_000;

const state = vi.hoisted(() => ({
  reports: null as unknown as InMemoryReportRepository,
  appOrigin: undefined as string | undefined,
  secret: undefined as string | undefined,
}));

vi.mock("../server/container.server", () => ({
  viewerAccessConfig: () => ({ secret: state.secret, appOrigin: state.appOrigin }),
  viewerDeps: () => ({
    reports: state.reports,
    grants: new InMemoryGrantStore(new FixedClock(NOW * 1000)),
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

beforeEach(async () => {
  vi.useFakeTimers();
  state.reports = new InMemoryReportRepository();
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

  it("offers Edit to a write capability, and withholds it on the owner-read degrade", async () => {
    const write = await get(`/${SLUG}/view`, `arp_view=${editToken()}`);
    expect(JSON.parse(await write.text()).canEdit).toBe(true);

    const readOnly = await get(`/${SLUG}/view`, `arp_view_oa=${encodeURIComponent(ownerAccess())}`);
    expect(JSON.parse(await readOnly.text()).canEdit).toBe(false);
  });

  it("carries the report title and the framed src", async () => {
    const res = await get(`/${SLUG}/view`, `arp_view=${editToken()}`);
    const data = JSON.parse(await res.text());
    expect(data.docTitle).toBe("Quarterly deck");
    expect(data.slug).toBe(SLUG);
  });
});
