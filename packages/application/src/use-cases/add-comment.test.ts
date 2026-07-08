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
  InMemoryCommentRepository,
  InMemoryEventOutbox,
  InMemoryIdentityStore,
  InMemoryReportRepository,
  InMemoryWriteGrantStore,
  PassThroughUnitOfWork,
  SequentialIdGenerator,
} from "../testing/in-memory";
import { addComment } from "./add-comment";

const orgA = orgId("00000000-0000-7000-8000-0000000000a1");
const orgB = orgId("00000000-0000-7000-8000-0000000000b1");
const owner = userId("00000000-0000-7000-8000-0000000000d1");
const otherUser = userId("00000000-0000-7000-8000-0000000000d2");
const ownerActor = { orgId: orgA, userId: owner };

function slug(s: string): Slug {
  const r = makeSlug(s);
  if (!r.ok) throw new Error("bad slug");
  return r.value;
}

function report(org: typeof orgA, slugStr: string, ownerId = owner): Report {
  return createReport({
    id: reportId(`00000000-0000-7000-8000-0000000000${slugStr.slice(0, 2)}`),
    orgId: org,
    folderId: folderId("00000000-0000-7000-8000-0000000000a0"),
    slug: slug(slugStr),
    title: "A Title",
    versionId: versionId("00000000-0000-7000-8000-0000000000e1"),
    contentHash: "h".repeat(64),
    uploadedBy: ownerId,
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
    uow: new PassThroughUnitOfWork(),
    grants: new InMemoryWriteGrantStore(),
    identities: new InMemoryIdentityStore(),
  };
}

describe("addComment use case", () => {
  it("creates a root comment for the report's owner and enqueues CommentAdded", async () => {
    const deps = makeDeps();
    await deps.reports.save(report(orgA, "aaaaaaaaaa"));

    const r = await addComment(deps, ownerActor, {
      slug: slug("aaaaaaaaaa"),
      body: "What does this mean?",
      anchor,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.authorUserId).toBe(owner);
    expect(r.value.parentCommentId).toBeNull();
    expect(r.value.createdAt).toBe(1000);

    expect(deps.outbox.drained()).toEqual([
      {
        type: "CommentAdded",
        commentId: r.value.id,
        reportId: r.value.reportId,
        authorUserId: owner,
        parentCommentId: null,
      },
    ]);

    const persisted = await deps.comments.findById(r.value.id);
    expect(persisted.ok && persisted.value?.body).toBe("What does this mean?");
  });

  it("rejects a non-owner with no write grant with NotAllowed (canWrite = isOwner OR hasWriteGrant, ADR-0064 §3 / ADR-0060 §4)", async () => {
    const deps = makeDeps();
    await deps.reports.save(report(orgA, "bbbbbbbbbb"));

    const r = await addComment(
      deps,
      { orgId: orgA, userId: otherUser },
      {
        slug: slug("bbbbbbbbbb"),
        body: "hi",
        anchor,
      },
    );
    expect(!r.ok && r.error.kind).toBe("NotAllowed");
  });

  it("allows the owner cross-org (canWrite is org-agnostic, ADR-0060 §4)", async () => {
    const deps = makeDeps();
    await deps.reports.save(report(orgA, "cccccccccc"));

    const r = await addComment(
      deps,
      { orgId: orgB, userId: owner },
      {
        slug: slug("cccccccccc"),
        body: "hi",
        anchor,
      },
    );
    expect(r.ok).toBe(true);
  });

  it("allows a cross-org write-grantee to author a comment (canWrite covers hasWriteGrant, real as of PR #150)", async () => {
    const deps = makeDeps();
    await deps.reports.save(report(orgA, "ffffffffff"));
    const grantee = userId("00000000-0000-7000-8000-0000000000d7");
    const granteeEmail = "grantee3@example.com";
    deps.identities.seedUser(grantee, granteeEmail);
    await deps.grants.grant(
      reportId("00000000-0000-7000-8000-0000000000ff"),
      granteeEmail,
      owner,
      grantee,
    );

    const r = await addComment(
      deps,
      { orgId: orgB, userId: grantee },
      {
        slug: slug("ffffffffff"),
        body: "a grantee's comment",
        anchor,
      },
    );
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.authorUserId).toBe(grantee);
  });

  it("rejects an unknown report with NotFound", async () => {
    const deps = makeDeps();
    const r = await addComment(deps, ownerActor, {
      slug: slug("dddddddddd"),
      body: "hi",
      anchor,
    });
    expect(!r.ok && r.error.kind).toBe("NotFound");
  });

  it("propagates a domain validation error (empty body) without persisting", async () => {
    const deps = makeDeps();
    await deps.reports.save(report(orgA, "eeeeeeeeee"));

    const r = await addComment(deps, ownerActor, {
      slug: slug("eeeeeeeeee"),
      body: "   ",
      anchor,
    });
    expect(!r.ok && r.error.kind).toBe("ValidationError");
    expect(deps.outbox.drained()).toEqual([]);
  });
});
