// ROUTE-level tests for `/unlock/{slug}` in `private` mode — the COMPOSED
// loader/action, not just `decidePrivateUnlock`.
//
// Why these exist (review #247 H-2): the unit tests for `decidePrivateUnlock`
// assert that an unknown slug is denied identically to a non-owner — but the
// composed route can NEVER reach that branch, because it resolves the report
// FIRST and short-circuits when there isn't one. So that unit test was false
// assurance for the property five places (this route, the server module,
// ADR-0056, ADR-0063 and the diary) actually claim: the denial is
// BYTE-IDENTICAL for "not entitled", "not signed in" and "no such report".
// Only a route-level test can hold that claim honest.
//
// They live under `app/server/` rather than `app/routes/` on purpose: any file
// in the Remix flat-routes directory becomes a ROUTE (`unlock.$slug.test.ts`
// would publish `/unlock/:slug/test`). The subject is still the real route
// module, imported below.
import { InMemoryReportRepository } from "arp-application/testing";
import {
  type Acl,
  createReport,
  folderId,
  makeSlug,
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
const OWNER = userId("00000000-0000-7000-8000-0000000000d1");
const STRANGER = userId("00000000-0000-7000-8000-0000000000d2");

const state = vi.hoisted(() => ({
  reports: null as unknown as InMemoryReportRepository,
  actor: null as { readonly orgId: unknown; readonly userId: unknown } | null,
}));

vi.mock("./auth.server", () => ({
  getAuth: async () => ({ userId: null, orgId: null }),
  resolveActorForRead: async () => ({ ok: true as const, value: state.actor }),
}));

// Only the collaborators the `private` branch actually touches are real; the
// password/allowlist/org wiring is stubbed, since those branches have their own
// coverage and would otherwise drag the whole composition root in.
vi.mock("./container.server", async () => {
  const testing = await import("arp-application/testing");
  const writeGrants = new testing.InMemoryWriteGrantStore();
  const identities = new testing.InMemoryIdentityStore();
  const orgWriteGrants = new testing.InMemoryOrgWriteGrantStore();
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

function buildReport(acl: Acl, opts: { readonly deleted?: boolean } = {}): Report {
  const { report } = createReport({
    id: reportId("00000000-0000-7000-8000-0000000000c1"),
    orgId: ORG,
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

/** Status + full body text — the two things "byte-identical" has to mean. */
async function shape(res: Response): Promise<{ status: number; body: string }> {
  return { status: res.status, body: await res.text() };
}

const PRIVATE: Acl = { mode: "private" };

describe("/unlock/{slug} loader — private mode (route level)", () => {
  beforeEach(() => {
    state.actor = null;
  });

  it("THE LOCKOUT FIX: the OWNER gets a 200 page linking to the ONE mint", async () => {
    await seed(buildReport(PRIVATE));
    state.actor = { orgId: ORG, userId: OWNER };
    const res = (await loader(args(SLUG))) as Response;
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toContain(`href="/reports/${SLUG}/open"`);
  });

  it("a non-owner gets the 403 private denial", async () => {
    await seed(buildReport(PRIVATE));
    state.actor = { orgId: ORG, userId: STRANGER };
    const res = (await loader(args(SLUG))) as Response;
    expect(res.status).toBe(403);
    await expect(res.text()).resolves.toContain("This report is private");
  });

  // THE EXISTENCE-ORACLE GUARD. Every one of these must be indistinguishable
  // from "you are not entitled to this private report" — otherwise
  // `/unlock/{slug}` reports whether a private slug exists to anyone who asks.
  it.each<[string, () => Promise<void>]>([
    ["not signed in", async () => seed(buildReport(PRIVATE))],
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
  ])("%s is denied byte-identically to a signed-in non-owner", async (_n, setup) => {
    await seed(buildReport(PRIVATE));
    state.actor = { orgId: ORG, userId: STRANGER };
    const baseline = await shape((await loader(args(SLUG))) as Response);

    state.actor = null;
    await setup();
    const actual = await shape((await loader(args(SLUG))) as Response);

    expect(actual).toEqual(baseline);
  });

  it("an invalid slug SHAPE is denied byte-identically too", async () => {
    await seed(buildReport(PRIVATE));
    state.actor = { orgId: ORG, userId: STRANGER };
    const baseline = await shape((await loader(args(SLUG))) as Response);
    const actual = await shape((await loader(args("bad!chars!"))) as Response);
    expect(actual).toEqual(baseline);
  });
});

describe("/unlock/{slug} action — private mode (route level)", () => {
  // The POST side is the same oracle: without this, someone who cannot
  // distinguish two slugs on GET just POSTs to them instead.
  it("an unknown slug's POST is denied byte-identically to a private report's POST", async () => {
    await seed(buildReport(PRIVATE));
    const baseline = await shape((await action(args(SLUG, "POST"))) as Response);
    await seed();
    const actual = await shape((await action(args(SLUG, "POST"))) as Response);
    expect(actual).toEqual(baseline);
  });
});
