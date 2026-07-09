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
import { replyToComment } from "./reply-to-comment";

const orgA = orgId("00000000-0000-7000-8000-0000000000a1");
const owner = userId("00000000-0000-7000-8000-0000000000d1");
const otherUser = userId("00000000-0000-7000-8000-0000000000d2");
const ownerActor = { orgId: orgA, userId: owner };

function slug(s: string): Slug {
  const r = makeSlug(s);
  if (!r.ok) throw new Error("bad slug");
  return r.value;
}

function report(slugStr: string): Report {
  return createReport({
    id: reportId(`00000000-0000-7000-8000-0000000000${slugStr.slice(0, 2)}`),
    orgId: orgA,
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

describe("replyToComment use case", () => {
  it("replies to a root comment and enqueues CommentAdded with parentCommentId set", async () => {
    const deps = makeDeps();
    await deps.reports.save(report("aaaaaaaaaa"));
    const root = await addComment(deps, ownerActor, {
      slug: slug("aaaaaaaaaa"),
      body: "root",
      anchor,
    });
    if (!root.ok) throw new Error("fixture failed");
    deps.clock.set(2000);

    const r = await replyToComment(deps, ownerActor, {
      slug: slug("aaaaaaaaaa"),
      parentCommentId: root.value.id,
      body: "a reply",
      anchor,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.parentCommentId).toBe(root.value.id);
    expect(r.value.createdAt).toBe(2000);
    expect(deps.outbox.drained()).toContainEqual({
      type: "CommentAdded",
      commentId: r.value.id,
      reportId: r.value.reportId,
      authorUserId: owner,
      parentCommentId: root.value.id,
    });
    expect(deps.audit.recorded()).toContainEqual({
      action: "comment.replied",
      orgId: orgA,
      actorUserId: owner,
      targetType: "comment",
      targetId: r.value.id,
      meta: { reportId: r.value.reportId, parentId: root.value.id },
    });
  });

  it("rejects replying to a reply (single-level threading, ADR-0064 Decision 2/4)", async () => {
    const deps = makeDeps();
    await deps.reports.save(report("bbbbbbbbbb"));
    const root = await addComment(deps, ownerActor, {
      slug: slug("bbbbbbbbbb"),
      body: "root",
      anchor,
    });
    if (!root.ok) throw new Error("fixture failed");
    const firstReply = await replyToComment(deps, ownerActor, {
      slug: slug("bbbbbbbbbb"),
      parentCommentId: root.value.id,
      body: "a reply",
      anchor,
    });
    if (!firstReply.ok) throw new Error("fixture failed");

    const r = await replyToComment(deps, ownerActor, {
      slug: slug("bbbbbbbbbb"),
      parentCommentId: firstReply.value.id,
      body: "a reply to a reply",
      anchor,
    });
    expect(!r.ok && r.error.kind).toBe("ValidationError");
  });

  it("rejects a non-owner with NotAllowed", async () => {
    const deps = makeDeps();
    await deps.reports.save(report("cccccccccc"));
    const root = await addComment(deps, ownerActor, {
      slug: slug("cccccccccc"),
      body: "root",
      anchor,
    });
    if (!root.ok) throw new Error("fixture failed");

    const r = await replyToComment(
      deps,
      { orgId: orgA, userId: otherUser },
      {
        slug: slug("cccccccccc"),
        parentCommentId: root.value.id,
        body: "a reply",
        anchor,
      },
    );
    expect(!r.ok && r.error.kind).toBe("NotAllowed");
  });

  it("rejects a parentCommentId from a different report with NotFound", async () => {
    const deps = makeDeps();
    await deps.reports.save(report("dddddddddd"));
    await deps.reports.save(report("eeeeeeeeee"));
    const rootOnOther = await addComment(deps, ownerActor, {
      slug: slug("eeeeeeeeee"),
      body: "root elsewhere",
      anchor,
    });
    if (!rootOnOther.ok) throw new Error("fixture failed");

    const r = await replyToComment(deps, ownerActor, {
      slug: slug("dddddddddd"),
      parentCommentId: rootOnOther.value.id,
      body: "a reply",
      anchor,
    });
    expect(!r.ok && r.error.kind).toBe("NotFound");
  });
});
