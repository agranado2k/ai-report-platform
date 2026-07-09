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
import { resolveComment } from "./resolve-comment";

const orgA = orgId("00000000-0000-7000-8000-0000000000a1");
const orgB = orgId("00000000-0000-7000-8000-0000000000b2");
const owner = userId("00000000-0000-7000-8000-0000000000d1");
// A same-org member with no write grant and no relation to the comment — for
// the moderation-check tests below.
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
    audit: new InMemoryAuditLogger(),
    uow: new PassThroughUnitOfWork(),
    grants: new InMemoryWriteGrantStore(),
    identities: new InMemoryIdentityStore(),
  };
}

describe("resolveComment use case", () => {
  it("lets the report owner (also the comment's author here) resolve, emitting CommentResolved", async () => {
    const deps = makeDeps();
    await deps.reports.save(report("aaaaaaaaaa"));
    const created = await addComment(deps, ownerActor, {
      slug: slug("aaaaaaaaaa"),
      body: "root",
      anchor,
    });
    if (!created.ok) throw new Error("fixture failed");
    deps.clock.set(5000);

    const r = await resolveComment(deps, ownerActor, {
      slug: slug("aaaaaaaaaa"),
      commentId: created.value.id,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resolvedAt).toBe(5000);
    expect(deps.outbox.drained()).toContainEqual({
      type: "CommentResolved",
      commentId: created.value.id,
      reportId: created.value.reportId,
      resolvedAt: 5000,
    });
    expect(deps.audit.recorded()).toContainEqual({
      action: "comment.resolved",
      orgId: orgA,
      actorUserId: owner,
      targetType: "comment",
      targetId: created.value.id,
      meta: { reportId: created.value.reportId },
    });
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

    const r = await resolveComment(
      deps,
      { orgId: orgA, userId: bystander },
      {
        slug: slug("bbbbbbbbbb"),
        commentId: created.value.id,
      },
    );
    expect(!r.ok && r.error.kind).toBe("NotAllowed");
  });

  it("is idempotent — resolving twice does not duplicate the event", async () => {
    const deps = makeDeps();
    await deps.reports.save(report("cccccccccc"));
    const created = await addComment(deps, ownerActor, {
      slug: slug("cccccccccc"),
      body: "root",
      anchor,
    });
    if (!created.ok) throw new Error("fixture failed");

    await resolveComment(deps, ownerActor, {
      slug: slug("cccccccccc"),
      commentId: created.value.id,
    });
    deps.clock.set(9999);
    const second = await resolveComment(deps, ownerActor, {
      slug: slug("cccccccccc"),
      commentId: created.value.id,
    });
    expect(second.ok && second.value.resolvedAt).toBe(1000); // unchanged
    expect(deps.outbox.drained().filter((e) => e.type === "CommentResolved")).toHaveLength(1);
  });

  it("rejects a comment id belonging to a different report with NotFound", async () => {
    const deps = makeDeps();
    await deps.reports.save(report("dddddddddd"));
    await deps.reports.save(report("eeeeeeeeee"));
    const elsewhere = await addComment(deps, ownerActor, {
      slug: slug("eeeeeeeeee"),
      body: "root",
      anchor,
    });
    if (!elsewhere.ok) throw new Error("fixture failed");

    const r = await resolveComment(deps, ownerActor, {
      slug: slug("dddddddddd"),
      commentId: elsewhere.value.id,
    });
    expect(!r.ok && r.error.kind).toBe("NotFound");
  });

  it("lets the owner resolve their own comment even acting under a different org context (loadReadableReport is owner-first, org-agnostic)", async () => {
    const deps = makeDeps();
    await deps.reports.save(report("ffffffffff"));
    const created = await addComment(deps, ownerActor, {
      slug: slug("ffffffffff"),
      body: "root",
      anchor,
    });
    if (!created.ok) throw new Error("fixture failed");

    const otherOrg = orgId("00000000-0000-7000-8000-0000000000b1");
    const r = await resolveComment(
      deps,
      { orgId: otherOrg, userId: owner },
      {
        slug: slug("ffffffffff"),
        commentId: created.value.id,
      },
    );
    expect(r.ok).toBe(true);
  });

  it("rejects a cross-org caller who is neither owner, org member, nor write-grantee with NotAllowed", async () => {
    const deps = makeDeps();
    await deps.reports.save(report("gggggggggg"));
    const created = await addComment(deps, ownerActor, {
      slug: slug("gggggggggg"),
      body: "root",
      anchor,
    });
    if (!created.ok) throw new Error("fixture failed");

    const otherOrg = orgId("00000000-0000-7000-8000-0000000000b1");
    const stranger = userId("00000000-0000-7000-8000-0000000000d4");
    const r = await resolveComment(
      deps,
      { orgId: otherOrg, userId: stranger },
      {
        slug: slug("gggggggggg"),
        commentId: created.value.id,
      },
    );
    expect(!r.ok && r.error.kind).toBe("NotAllowed");
  });

  it("lets a cross-org write-grantee author a comment via canWrite, then resolve their OWN comment outside the report's org (ADR-0060 §4, real as of PR #150)", async () => {
    const deps = makeDeps();
    await deps.reports.save(report("hhhhhhhhhh"));
    const grantee = userId("00000000-0000-7000-8000-0000000000d5");
    const granteeEmail = "grantee@example.com";
    deps.identities.seedUser(grantee, granteeEmail);
    await deps.grants.grant(
      reportId("00000000-0000-7000-8000-0000000000hh"),
      granteeEmail,
      owner,
      grantee,
    );
    const granteeActor = { orgId: orgB, userId: grantee };

    // canWrite (loadWritableReport) lets the cross-org grantee author a root comment.
    const created = await addComment(deps, granteeActor, {
      slug: slug("hhhhhhhhhh"),
      body: "a grantee's comment",
      anchor,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.authorUserId).toBe(grantee);

    // loadReadableReport (owner OR org OR grantee) lets that SAME grantee resolve
    // their own comment, still acting outside the report's org.
    const resolved = await resolveComment(deps, granteeActor, {
      slug: slug("hhhhhhhhhh"),
      commentId: created.value.id,
    });
    expect(resolved.ok).toBe(true);
    expect(resolved.ok && resolved.value.resolvedAt).not.toBeNull();
  });
});
