import {
  type Anchor,
  commentId,
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
import { deleteComment } from "./delete-comment";

const orgA = orgId("00000000-0000-7000-8000-0000000000a1");
const owner = userId("00000000-0000-7000-8000-0000000000d1");
const bystander = userId("00000000-0000-7000-8000-0000000000d3");
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
    uow: new PassThroughUnitOfWork(),
    grants: new InMemoryWriteGrantStore(),
    identities: new InMemoryIdentityStore(),
  };
}

describe("deleteComment use case", () => {
  it("lets the report owner delete a comment", async () => {
    const deps = makeDeps();
    await deps.reports.save(report("aaaaaaaaaa"));
    const created = await addComment(deps, ownerActor, {
      slug: slug("aaaaaaaaaa"),
      body: "root",
      anchor,
    });
    if (!created.ok) throw new Error("fixture failed");

    const r = await deleteComment(deps, ownerActor, {
      slug: slug("aaaaaaaaaa"),
      commentId: created.value.id,
    });
    expect(r.ok).toBe(true);
    const found = await deps.comments.findById(created.value.id);
    expect(found.ok && found.value).toBeNull();
  });

  it("rejects an org member who is neither the author nor the owner", async () => {
    const deps = makeDeps();
    await deps.reports.save(report("bbbbbbbbbb"));
    const created = await addComment(deps, ownerActor, {
      slug: slug("bbbbbbbbbb"),
      body: "root",
      anchor,
    });
    if (!created.ok) throw new Error("fixture failed");

    const r = await deleteComment(
      deps,
      { orgId: orgA, userId: bystander },
      {
        slug: slug("bbbbbbbbbb"),
        commentId: created.value.id,
      },
    );
    expect(!r.ok && r.error.kind).toBe("NotAllowed");
    const found = await deps.comments.findById(created.value.id);
    expect(found.ok && found.value).not.toBeNull(); // untouched
  });

  it("rejects an unknown comment id with NotFound", async () => {
    const deps = makeDeps();
    await deps.reports.save(report("cccccccccc"));

    const r = await deleteComment(deps, ownerActor, {
      slug: slug("cccccccccc"),
      commentId: commentId("00000000-0000-7000-8000-0000000000ff"),
    });
    expect(!r.ok && r.error.kind).toBe("NotFound");
  });

  it("lets a cross-org write-grantee delete their OWN comment outside the report's org (ADR-0060 §4, real as of PR #150)", async () => {
    const deps = makeDeps();
    await deps.reports.save(report("iiiiiiiiii"));
    const grantee = userId("00000000-0000-7000-8000-0000000000d6");
    const granteeEmail = "grantee2@example.com";
    deps.identities.seedUser(grantee, granteeEmail);
    await deps.grants.grant(
      reportId("00000000-0000-7000-8000-0000000000ii"),
      granteeEmail,
      owner,
      grantee,
    );
    const orgB = orgId("00000000-0000-7000-8000-0000000000b2");
    const granteeActor = { orgId: orgB, userId: grantee };

    const created = await addComment(deps, granteeActor, {
      slug: slug("iiiiiiiiii"),
      body: "a grantee's comment",
      anchor,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const r = await deleteComment(deps, granteeActor, {
      slug: slug("iiiiiiiiii"),
      commentId: created.value.id,
    });
    expect(r.ok).toBe(true);
    const found = await deps.comments.findById(created.value.id);
    expect(found.ok && found.value).toBeNull();
  });
});
