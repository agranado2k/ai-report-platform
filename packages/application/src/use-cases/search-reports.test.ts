import {
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
import { describe, expect, it } from "vitest";
import {
  InMemoryIdentityStore,
  InMemoryReportRepository,
  InMemoryWriteGrantStore,
} from "../testing/in-memory";
import { searchReports } from "./search-reports";

const orgA = orgId("00000000-0000-7000-8000-0000000000a1");
const F1 = folderId("00000000-0000-7000-8000-0000000000f1");
const F2 = folderId("00000000-0000-7000-8000-0000000000f2");
// OWNER owns every fixture rep() builds; COLLEAGUE is a same-org user who owns
// nothing (the ADR-0075 visibility matrix's second leg — the deep matrix lives
// in the ReportRepository contract suite; here we prove the use case wires the
// viewer through, email resolution included).
const OWNER = userId("00000000-0000-7000-8000-0000000000d1");
const COLLEAGUE = userId("00000000-0000-7000-8000-0000000000d2");
const COLLEAGUE_EMAIL = "colleague@example.test";

function slug(s: string): Slug {
  const r = makeSlug(s);
  if (!r.ok) throw new Error("bad slug");
  return r.value;
}
function rep(slugStr: string, title: string, folder = F1): Report {
  return createReport({
    id: reportId(`id-${slugStr}`), // unique per slug (the fake keys byId)
    orgId: orgA,
    folderId: folder,
    slug: slug(slugStr),
    title,
    versionId: versionId("00000000-0000-7000-8000-0000000000e1"),
    contentHash: "h".repeat(64),
    uploadedBy: OWNER,
    manifest: { entryDocument: "index.html", files: ["index.html"] },
    sizeBytes: 1,
  }).report;
}

function makeDeps(writeGrants = new InMemoryWriteGrantStore()) {
  const identities = new InMemoryIdentityStore();
  identities.seedUser(OWNER, "owner@example.test");
  identities.seedUser(COLLEAGUE, COLLEAGUE_EMAIL);
  return {
    reports: new InMemoryReportRepository(writeGrants),
    identities,
    writeGrants,
  };
}

async function seed(n: number) {
  const deps = makeDeps();
  for (let i = 0; i < n; i++) {
    await deps.reports.save(rep(`aaaaaaaa${String(i).padStart(2, "0")}`, `Report ${i}`));
  }
  return deps;
}

const asOwner = { orgId: orgA, userId: OWNER };
const asColleague = { orgId: orgA, userId: COLLEAGUE };

describe("searchReports use case (cursor pagination, ADR-0053)", () => {
  it("returns the first page newest-created-first, with has_more", async () => {
    const deps = await seed(25);
    const r = await searchReports(deps, asOwner, { limit: 10 });
    expect(r.ok && r.value.items.length).toBe(10);
    expect(r.ok && r.value.hasMore).toBe(true);
    // id DESC = newest-created first → Report 24 leads (highest id suffix)
    expect(r.ok && r.value.items[0]?.title).toBe("Report 24");
  });

  it("pages forward with starting_after until has_more is false, no overlap", async () => {
    const deps = await seed(25);
    const seen = new Set<string>();
    let cursor: ReturnType<typeof reportId> | undefined;
    let pages = 0;
    for (;;) {
      const r = await searchReports(deps, asOwner, { limit: 10, startingAfter: cursor });
      if (!r.ok) throw new Error("search failed");
      for (const it of r.value.items) {
        expect(seen.has(it.id)).toBe(false); // no overlap across pages
        seen.add(it.id);
      }
      pages++;
      if (!r.value.hasMore) break;
      cursor = r.value.items[r.value.items.length - 1]?.id;
    }
    expect(seen.size).toBe(25); // every report, exactly once
    expect(pages).toBe(3); // 10 + 10 + 5
  });

  it("pages backward with ending_before (Prev) → the previous page, has_more=false at the start", async () => {
    const deps = await seed(25);
    const p1 = await searchReports(deps, asOwner, { limit: 10 });
    if (!p1.ok) throw new Error("p1");
    const p2 = await searchReports(deps, asOwner, {
      limit: 10,
      startingAfter: p1.value.items[9]?.id,
    });
    if (!p2.ok) throw new Error("p2");
    // ending_before page 2's first id → back to page 1's items, in the same order
    const back = await searchReports(deps, asOwner, {
      limit: 10,
      endingBefore: p2.value.items[0]?.id,
    });
    expect(back.ok && back.value.items.map((r) => r.id)).toEqual(p1.value.items.map((r) => r.id));
    // page 1 is the start — no more (newer) items before it
    expect(back.ok && back.value.hasMore).toBe(false);
  });

  it("filters by a case-insensitive title query", async () => {
    const deps = makeDeps();
    await deps.reports.save(rep("aaaaaaaaaa", "Quarterly revenue"));
    await deps.reports.save(rep("bbbbbbbbbb", "Annual summary"));
    const r = await searchReports(deps, asOwner, { query: "QUARTER", limit: 10 });
    expect(r.ok && r.value.items.length).toBe(1);
    expect(r.ok && r.value.hasMore).toBe(false);
    expect(r.ok && r.value.items[0]?.title).toBe("Quarterly revenue");
  });

  it("filters by folder", async () => {
    const deps = makeDeps();
    await deps.reports.save(rep("aaaaaaaaaa", "In F1", F1));
    await deps.reports.save(rep("bbbbbbbbbb", "In F2", F2));
    const r = await searchReports(deps, asOwner, { folderId: F2, limit: 10 });
    expect(r.ok && r.value.items.length).toBe(1);
    expect(r.ok && r.value.items[0]?.folderId).toBe(F2);
  });

  it("clamps the limit (default 20; over-max returns all when small)", async () => {
    const deps = await seed(3);
    const def = await searchReports(deps, asOwner, {}); // no limit → default
    expect(def.ok && def.value.items.length).toBe(3);
    const big = await searchReports(deps, asOwner, { limit: 100_000 });
    expect(big.ok && big.value.items.length).toBe(3); // clamped to ≤100, all 3 fit
  });

  // ── ADR-0075: the viewer is wired through to the visibility predicate ────
  // (The full owned/org/public/password/allowlist/grant matrix is the
  // ReportRepository contract suite's job — these prove the use case passes
  // the acting user + resolved email down.)

  it("hides another owner's default-private reports from a same-org colleague", async () => {
    const deps = await seed(3);
    const r = await searchReports(deps, asColleague, { limit: 10 });
    expect(r.ok && r.value.items).toHaveLength(0);
    expect(r.ok && r.value.hasMore).toBe(false);
  });

  it("lists an org-shared report for a colleague alongside nothing private", async () => {
    const deps = makeDeps();
    const shared = rep("aaaaaaaaaa", "Org shared");
    await deps.reports.save(shared);
    await deps.reports.setAcl(shared.id, { mode: "org" });
    await deps.reports.save(rep("bbbbbbbbbb", "Still private"));

    const r = await searchReports(deps, asColleague, { limit: 10 });
    expect(r.ok && r.value.items.map((i) => i.title)).toEqual(["Org shared"]);
  });

  it("resolves the actor's email so an email-only write grant lists the report", async () => {
    const deps = makeDeps();
    const granted = rep("aaaaaaaaaa", "Email granted");
    await deps.reports.save(granted);
    // granteeUserId null → only the email match (via identities) can hit.
    await deps.writeGrants.grant(granted.id, COLLEAGUE_EMAIL, OWNER, null);

    const r = await searchReports(deps, asColleague, { limit: 10 });
    expect(r.ok && r.value.items.map((i) => i.title)).toEqual(["Email granted"]);
  });
});
