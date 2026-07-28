import {
  type Anchor,
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
  FixedClock,
  InMemoryAuditLogger,
  InMemoryCommentRepository,
  InMemoryEventOutbox,
  InMemoryIdentityStore,
  InMemoryReportRepository,
  InMemoryWriteGrantStore,
  PassThroughUnitOfWork,
  SequentialIdGenerator,
} from "../testing/in-memory";
import { addComment } from "./add-comment";
import { listComments } from "./list-comments";

const orgA = orgId("00000000-0000-7000-8000-0000000000a1");
const orgB = orgId("00000000-0000-7000-8000-0000000000b1");
const owner = userId("00000000-0000-7000-8000-0000000000d1");
const ownerActor = { orgId: orgA, userId: owner };

function slug(s: string): Slug {
  const r = makeSlug(s);
  if (!r.ok) throw new Error("bad slug");
  return r.value;
}

function report(org: typeof orgA, slugStr: string): Report {
  return createReport({
    id: reportId(`00000000-0000-7000-8000-0000000000${slugStr.slice(0, 2)}`),
    orgId: org,
    folderId: folderId("00000000-0000-7000-8000-0000000000a0"),
    slug: slug(slugStr),
    title: "A Title",
    versionId: versionId("00000000-0000-7000-8000-0000000000e1"),
    contentHash: "h".repeat(64),
    uploadedBy: owner,
    manifest: { entryDocument: "index.html", files: ["index.html"] },
    sizeBytes: 1,
  }).report;
}

const anchor: Anchor = {
  versionPinned: { versionId: versionId("00000000-0000-7000-8000-0000000000e1"), textQuote: "hi" },
};

function makeDeps() {
  return {
    reports: new InMemoryReportRepository(),
    comments: new InMemoryCommentRepository(),
    ids: new SequentialIdGenerator(),
    clock: new FixedClock(1000),
    outbox: new InMemoryEventOutbox(),
    audit: new InMemoryAuditLogger(),
    uow: new PassThroughUnitOfWork(),
    grants: new InMemoryWriteGrantStore(),
    identities: new InMemoryIdentityStore(),
  };
}

describe("listComments use case", () => {
  it("returns a report's comments newest-created first, for an org member", async () => {
    const deps = makeDeps();
    await deps.reports.save(report(orgA, "aaaaaaaaaa"));
    const first = await addComment(deps, ownerActor, {
      slug: slug("aaaaaaaaaa"),
      body: "first",
      anchor,
    });
    const second = await addComment(deps, ownerActor, {
      slug: slug("aaaaaaaaaa"),
      body: "second",
      anchor,
    });
    if (!first.ok || !second.ok) throw new Error("fixture failed");

    const r = await listComments(
      { reports: deps.reports, comments: deps.comments },
      { orgId: orgA },
      {
        slug: slug("aaaaaaaaaa"),
      },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items.map((c) => c.id)).toEqual([second.value.id, first.value.id]);
    expect(r.value.hasMore).toBe(false);
  });

  it("rejects a cross-org report with NotAllowed (comments never surface cross-org, ADR-0064 §4)", async () => {
    const deps = makeDeps();
    await deps.reports.save(report(orgA, "bbbbbbbbbb"));
    const r = await listComments(
      { reports: deps.reports, comments: deps.comments },
      { orgId: orgB },
      {
        slug: slug("bbbbbbbbbb"),
      },
    );
    expect(!r.ok && r.error.kind).toBe("NotAllowed");
  });

  it("rejects an unknown report with NotFound", async () => {
    const deps = makeDeps();
    const r = await listComments(
      { reports: deps.reports, comments: deps.comments },
      { orgId: orgA },
      {
        slug: slug("cccccccccc"),
      },
    );
    expect(!r.ok && r.error.kind).toBe("NotFound");
  });

  it("paginates with a default limit and honors an explicit limit + has_more", async () => {
    const deps = makeDeps();
    await deps.reports.save(report(orgA, "dddddddddd"));
    for (let i = 0; i < 3; i += 1) {
      await addComment(deps, ownerActor, { slug: slug("dddddddddd"), body: `c${i}`, anchor });
    }
    const page = await listComments(
      { reports: deps.reports, comments: deps.comments },
      { orgId: orgA },
      { slug: slug("dddddddddd"), limit: 2 },
    );
    expect(page.ok && page.value.items.length).toBe(2);
    expect(page.ok && page.value.hasMore).toBe(true);
  });
});
