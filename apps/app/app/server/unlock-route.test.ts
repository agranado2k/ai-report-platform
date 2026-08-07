// ROUTE-level tests for `/unlock/{slug}` — the COMPOSED loader/action, not just
// `decidePrivateUnlock`.
//
// Why these exist (review #247 H-2): the unit tests for `decidePrivateUnlock`
// assert that an unknown slug is denied identically to a non-owner — but the
// composed route can NEVER reach that branch, because it resolves the report
// FIRST and short-circuits when there isn't one. So that unit test was false
// assurance for the property five places (this route, the server module,
// ADR-0056, ADR-0063 and the diary) actually claim. Only a route-level test can
// hold that claim honest.
//
// THE PROPERTY, as the operator settled it on 2026-08-06: EVERY denial this
// page issues — in ANY sharing mode, on GET and on POST — is a byte-identical
// `404`. Not a `403`: a 403 saying "this report is private" still CONFIRMS the
// report exists, so a uniform 404 is the only answer that leaks nothing. The
// `it.each` matrix below enumerates every denial class and compares status,
// body AND headers against one baseline.
//
// They live under `app/server/` rather than `app/routes/` on purpose: any file
// in the Remix flat-routes directory becomes a ROUTE (`unlock.$slug.test.ts`
// would publish `/unlock/:slug/test`). The subject is still the real route
// module, imported below.

import { readFileSync } from "node:fs";
import path from "node:path";
import { InMemoryReportRepository } from "arp-application/testing";
import {
  type Acl,
  createReport,
  folderId,
  makeSlug,
  type OrgId,
  orgId,
  type Report,
  reportId,
  type Slug,
  userId,
  versionId,
} from "arp-domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SLUG = "aaaaaaaaaa";
const ORG = orgId("00000000-0000-7000-8000-0000000000a1");
const OTHER_ORG = orgId("00000000-0000-7000-8000-0000000000a2");
const OWNER = userId("00000000-0000-7000-8000-0000000000d1");
const STRANGER = userId("00000000-0000-7000-8000-0000000000d2");

const state = vi.hoisted(() => ({
  reports: null as unknown as InMemoryReportRepository,
  actor: null as { readonly orgId: unknown; readonly userId: unknown } | null,
  /** What Clerk reports for the session — drives the `org` mode handshake. */
  auth: { userId: null as string | null, orgId: null as string | null },
  /** What `findOrgByClerkOrgId` maps the session's Clerk org to. */
  memberOrgId: null as unknown,
}));

vi.mock("./auth.server", () => ({
  getAuth: async () => state.auth,
  resolveActorForRead: async () => ({ ok: true as const, value: state.actor }),
}));

// Only the collaborators the denial branches actually touch are real; the
// password/allowlist wiring is stubbed, since those branches have their own
// coverage and would otherwise drag the whole composition root in.
vi.mock("./container.server", async () => {
  const testing = await import("arp-application/testing");
  const writeGrants = new testing.InMemoryWriteGrantStore();
  const orgWriteGrants = new testing.InMemoryOrgWriteGrantStore();
  // `loadWritableReport` only needs `findEmailByUserId`; the `org` handshake
  // only needs `findOrgByClerkOrgId` — driven from `state` so a test can put
  // the session in or out of the report's org.
  const identities = {
    findEmailByUserId: async () => ({ ok: true as const, value: null }),
    findOrgByClerkOrgId: async () => ({ ok: true as const, value: state.memberOrgId }),
  };
  return {
    accessTokenSecret: () => "unlock-route-test-secret",
    appOrigin: () => "https://app.example.test",
    clock: () => null,
    deps: () => ({ reports: state.reports }),
    emailSender: () => null,
    grantStore: () => null,
    identityStore: () => identities,
    nonceStore: () => null,
    orgWriteGrantStore: () => orgWriteGrants,
    passwordHasher: () => ({ verify: async () => ({ ok: true, value: false }) }),
    viewOrigin: () => "https://view.example.test",
    writeGrantStore: () => writeGrants,
  };
});

const { action, loader } = await import("../routes/unlock.$slug");

function slug(s: string): Slug {
  const r = makeSlug(s);
  if (!r.ok) throw new Error(`bad test slug ${s}`);
  return r.value;
}

function buildReport(
  acl: Acl,
  opts: { readonly deleted?: boolean; readonly org?: OrgId } = {},
): Report {
  const { report } = createReport({
    id: reportId("00000000-0000-7000-8000-0000000000c1"),
    orgId: opts.org ?? ORG,
    folderId: folderId("00000000-0000-7000-8000-0000000000f1"),
    slug: slug(SLUG),
    title: "T",
    versionId: versionId("00000000-0000-7000-8000-0000000000e1"),
    contentHash: "h".repeat(64),
    uploadedBy: OWNER,
    manifest: { entryDocument: "index.html", files: ["index.html"] },
    sizeBytes: 1,
  });
  const withAcl: Report = { ...report, acl };
  return opts.deleted ? { ...withAcl, deletedAt: 1000 } : withAcl;
}

async function seed(report?: Report): Promise<void> {
  state.reports = new InMemoryReportRepository();
  if (report) await state.reports.save(report);
}

const args = (rawSlug: string, method = "GET") =>
  ({
    params: { slug: rawSlug },
    request: new Request(`https://app.example.test/unlock/${rawSlug}`, { method }),
    context: {},
  }) as never;

/** Status + full body text + every response header — the three things
 *  "byte-identical" has to mean for a response that must not be a side channel.
 *  Headers are sorted so ordering can't make two identical answers compare
 *  unequal (nor mask a difference). */
async function shape(
  res: Response,
): Promise<{ status: number; body: string; headers: readonly string[] }> {
  return {
    status: res.status,
    body: await res.text(),
    headers: [...res.headers].map(([k, v]) => `${k}: ${v}`).sort(),
  };
}

const PRIVATE: Acl = { mode: "private" };
const ORG_MODE: Acl = { mode: "org" };

/** The baseline every denial must match: a signed-in, same-org NON-OWNER
 *  asking for a `private` report that genuinely exists. */
async function baselineDenial(): Promise<Awaited<ReturnType<typeof shape>>> {
  await seed(buildReport(PRIVATE));
  state.actor = { orgId: ORG, userId: STRANGER };
  state.auth = { userId: "clerk_stranger", orgId: "clerk_org_1" };
  state.memberOrgId = ORG;
  return shape((await loader(args(SLUG))) as Response);
}

function resetSession(): void {
  state.actor = null;
  state.auth = { userId: null, orgId: null };
  state.memberOrgId = null;
}

describe("/unlock/{slug} loader — private mode (route level)", () => {
  beforeEach(resetSession);

  it("THE LOCKOUT FIX: the OWNER gets a 200 page linking to the ONE mint", async () => {
    await seed(buildReport(PRIVATE));
    state.actor = { orgId: ORG, userId: OWNER };
    const res = (await loader(args(SLUG))) as Response;
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toContain(`href="/reports/${SLUG}/open"`);
  });

  it("a non-owner gets a 404 — NOT a 403 that would confirm the report exists", async () => {
    await seed(buildReport(PRIVATE));
    state.actor = { orgId: ORG, userId: STRANGER };
    const res = (await loader(args(SLUG))) as Response;
    expect(res.status).toBe(404);
    await expect(res.text()).resolves.not.toContain("private");
  });
});

// These pages are the product's front door for anyone who arrives at a link
// they cannot open — including the report's OWNER. They shipped as raw
// user-agent-default HTML (Times New Roman on white, default-blue links), which
// on a page that says "this report is private" reads as a broken site rather
// than a deliberate boundary. The route comment blamed the app-origin CSP, but
// `app-headers.ts` sets `style-src 'self' 'unsafe-inline'` and these raw
// Responses carry only `frame-ancestors 'none'` — inline styles were always
// allowed here.
describe("/unlock/{slug} — the page is presented, not raw", () => {
  beforeEach(resetSession);

  it("ships a stylesheet with the page", async () => {
    await seed(buildReport(PRIVATE));
    state.actor = { orgId: ORG, userId: OWNER };
    const body = await ((await loader(args(SLUG))) as Response).text();

    expect(body).toContain("<style>");
    // Typography and surface, the two things whose ABSENCE produced the raw
    // Times-New-Roman-on-white page. Asserted via the `font:`/`background:`
    // properties the sheet actually sets, not a longhand it never uses.
    expect(body).toMatch(/\bfont:/);
    expect(body).toMatch(/\bbackground:/);
  });

  it("styles the DENIAL page too — a 404 is a front door as much as a form", async () => {
    await seed(buildReport(PRIVATE));
    state.actor = { orgId: ORG, userId: STRANGER };
    const body = await ((await loader(args(SLUG))) as Response).text();

    expect(body).toContain("<style>");
  });

  it("keeps the styling in the shell, never in the per-page copy", async () => {
    // The denial's bytes must stay uniform across every mode (the guard
    // below), so the styling has to live in the ONE wrapper, not be threaded
    // through each caller where it could drift per branch.
    await seed(buildReport(PRIVATE));
    state.actor = { orgId: ORG, userId: OWNER };
    const body = await ((await loader(args(SLUG))) as Response).text();

    expect(body.indexOf("<style>")).toBeLessThan(body.indexOf("<body"));
  });
});

// TOKEN DRIFT. The page inlines its palette because a raw Response has no build
// step to @import `packages/ui/src/theme.css`. Transcribed values are a
// standing liability: theme.css is the single source of truth for BOTH origins,
// and nothing about editing it would otherwise tell you this page exists. So
// the transcription is asserted against the real file — a token retuned there
// and not here fails the build instead of shipping an unlock page that no
// longer matches the product around it.
describe("/unlock/{slug} — the inlined palette tracks packages/ui/src/theme.css", () => {
  beforeEach(resetSession);

  /** `--name: value;` pairs from the FIRST :root block of a stylesheet. */
  const rootTokens = (css: string): Map<string, string> => {
    const root = /:root\s*\{([\s\S]*?)\}/.exec(css);
    const out = new Map<string, string>();
    for (const m of (root?.[1] ?? "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      const [, k, v] = m;
      if (k && v) out.set(k, v.trim());
    }
    return out;
  };

  it("uses the same value for every token it borrows", async () => {
    const themeCss = readFileSync(
      path.resolve(__dirname, "../../../../packages/ui/src/theme.css"),
      "utf-8",
    );
    await seed(buildReport(PRIVATE));
    state.actor = { orgId: ORG, userId: OWNER };
    const page = await ((await loader(args(SLUG))) as Response).text();

    const theme = rootTokens(themeCss);
    const inlined = rootTokens(page.slice(page.indexOf("<style>")));

    // Guard the guard: if the page stops declaring tokens, this test must fail
    // rather than vacuously compare an empty map.
    expect(inlined.size).toBeGreaterThan(5);

    for (const [name, value] of inlined) {
      const upstream = theme.get(name);
      expect(upstream, `${name} is inlined here but absent from theme.css`).toBeDefined();
      expect(value, `${name} drifted from theme.css`).toBe(upstream);
    }
  });

  it("stays dark-only, like the rest of the product", async () => {
    // The first cut honoured `prefers-color-scheme` and rendered LIGHT in a
    // browser where the dashboard beside it rendered dark. theme.css sets
    // `color-scheme: dark` unconditionally; there is no light mode to opt into.
    await seed(buildReport(PRIVATE));
    state.actor = { orgId: ORG, userId: OWNER };
    const page = await ((await loader(args(SLUG))) as Response).text();

    expect(page).toContain("color-scheme: dark");
    expect(page).not.toContain("prefers-color-scheme");
  });
});

// THE EXISTENCE-ORACLE GUARD, over EVERY denial class this page can produce.
// Each must be indistinguishable — same status, same bytes, same headers —
// from "you are a signed-in non-owner of a private report that exists".
// Otherwise `/unlock/{slug}` reports whether a slug exists to anyone who asks.
describe("/unlock/{slug} — every denial is a byte-identical 404", () => {
  beforeEach(resetSession);

  it.each<[string, () => Promise<void>]>([
    ["signed-out, private report", async () => seed(buildReport(PRIVATE))],
    [
      "no such report",
      async () => {
        await seed();
        state.actor = { orgId: ORG, userId: OWNER };
      },
    ],
    [
      "a soft-deleted report",
      async () => {
        await seed(buildReport(PRIVATE, { deleted: true }));
        state.actor = { orgId: ORG, userId: OWNER };
      },
    ],
    [
      "same-org non-owner",
      async () => {
        await seed(buildReport(PRIVATE));
        state.actor = { orgId: ORG, userId: STRANGER };
      },
    ],
    [
      // NB the actor here is a STRANGER, not the owner: `loadOwnedReport` is
      // deliberately org-AGNOSTIC ("ownership, not tenancy, decides"), so an
      // owner reaching their own report from a different session org is a
      // supported flow, not a denial. The denial is a non-owner in another org.
      "cross-org visitor",
      async () => {
        await seed(buildReport(PRIVATE, { org: OTHER_ORG }));
        state.actor = { orgId: ORG, userId: STRANGER };
      },
    ],
    [
      // Previously `403 "You need to be a member of this report's
      // organization to view it."` — itself an existence oracle: it confirmed
      // both that the slug exists AND which sharing mode it uses.
      "org-mode report, signed-in NON-member",
      async () => {
        await seed(buildReport(ORG_MODE, { org: OTHER_ORG }));
        state.auth = { userId: "clerk_stranger", orgId: "clerk_org_1" };
        state.memberOrgId = ORG;
      },
    ],
    [
      "org-mode report, signed in with no active org",
      async () => {
        await seed(buildReport(ORG_MODE));
        state.auth = { userId: "clerk_stranger", orgId: null };
      },
    ],
    [
      "org-mode report, session org maps to no internal org",
      async () => {
        await seed(buildReport(ORG_MODE));
        state.auth = { userId: "clerk_stranger", orgId: "clerk_unknown" };
        state.memberOrgId = null;
      },
    ],
  ])("GET: %s", async (_name, setup) => {
    const baseline = await baselineDenial();
    resetSession();
    await setup();
    expect(await shape((await loader(args(SLUG))) as Response)).toEqual(baseline);
  });

  it("GET: an invalid slug SHAPE is denied byte-identically too", async () => {
    const baseline = await baselineDenial();
    resetSession();
    await seed(buildReport(PRIVATE));
    expect(await shape((await loader(args("bad!chars!"))) as Response)).toEqual(baseline);
  });

  // The POST side is the same oracle: someone who cannot distinguish two slugs
  // on GET just POSTs to them instead.
  it.each<[string, string, () => Promise<void>]>([
    ["a private report", SLUG, async () => seed(buildReport(PRIVATE))],
    ["no such report", SLUG, async () => seed()],
    ["a soft-deleted report", SLUG, async () => seed(buildReport(PRIVATE, { deleted: true }))],
    ["an invalid slug shape", "bad!chars!", async () => seed(buildReport(PRIVATE))],
  ])("POST: %s is denied byte-identically to the GET baseline", async (_n, raw, setup) => {
    const baseline = await baselineDenial();
    resetSession();
    await setup();
    expect(await shape((await action(args(raw, "POST"))) as Response)).toEqual(baseline);
  });
});

// The denials are uniform; the NON-denials must not have been swept up with
// them. Each of these is a legitimate forward path, and each one necessarily
// looks different from the 404 — that asymmetry is intended and bounded: it
// reveals only what the visitor is already entitled to act on.
describe("/unlock/{slug} — flows that are NOT denials still work", () => {
  beforeEach(resetSession);

  it("a public report still redirects to the viewer", async () => {
    await seed(buildReport({ mode: "public" }));
    const res = (await loader(args(SLUG))) as Response;
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`https://view.example.test/${SLUG}`);
  });

  it("a password report still renders its form", async () => {
    await seed(buildReport({ mode: "password", passwordHash: "x" }));
    const res = (await loader(args(SLUG))) as Response;
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toContain('name="password"');
  });

  it("an allowlist report still renders its email form", async () => {
    await seed(buildReport({ mode: "allowlist", allowedEmails: [], accessTtlSeconds: 900 }));
    const res = (await loader(args(SLUG))) as Response;
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toContain('name="email"');
  });

  it("an ANONYMOUS visitor to an org report is still bounced to sign-in", async () => {
    await seed(buildReport(ORG_MODE));
    const res = (await loader(args(SLUG))) as Response;
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/sign-in?redirect_url=");
  });

  it("an actual org MEMBER still completes the handshake", async () => {
    await seed(buildReport(ORG_MODE));
    state.auth = { userId: "clerk_member", orgId: "clerk_org_1" };
    state.memberOrgId = ORG;
    const res = (await loader(args(SLUG))) as Response;
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain(`https://view.example.test/${SLUG}?access=`);
  });
});
