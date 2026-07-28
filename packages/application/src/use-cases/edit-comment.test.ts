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
import { editComment } from "./edit-comment";

const orgA = orgId("00000000-0000-7000-8000-0000000000a1");
const orgB = orgId("00000000-0000-7000-8000-0000000000b2");
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
    audit: new InMemoryAuditLogger(),
    uow: new PassThroughUnitOfWork(),
    grants: new InMemoryWriteGrantStore(),
    identities: new InMemoryIdentityStore(),
  };
}

describe("editComment use case", () => {
  it("lets the author edit body + intent, persists, emits CommentEdited + audits", async () => {
    const deps = makeDeps();
    await deps.reports.save(report("aaaaaaaaaa"));
    const created = await addComment(deps, ownerActor, {
      slug: slug("aaaaaaaaaa"),
      body: "original",
      anchor,
      intent: "note",
    });
    if (!created.ok) throw new Error("fixture failed");
    deps.clock.set(5000);

    const r = await editComment(deps, ownerActor, {
      slug: slug("aaaaaaaaaa"),
      commentId: created.value.id,
      body: "corrected typo",
      intent: "enhancement",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.body).toBe("corrected typo");
    expect(r.value.intent).toBe("enhancement");

    // persisted
    const reloaded = await deps.comments.findById(created.value.id);
    expect(reloaded.ok && reloaded.value?.body).toBe("corrected typo");
    expect(reloaded.ok && reloaded.value?.intent).toBe("enhancement");

    expect(deps.outbox.drained()).toContainEqual({
      type: "CommentEdited",
      commentId: created.value.id,
      reportId: created.value.reportId,
      editedAt: 5000,
    });
    expect(deps.audit.recorded()).toContainEqual({
      action: "comment.edited",
      orgId: orgA,
      actorUserId: owner,
      targetType: "comment",
      targetId: created.value.id,
      meta: { reportId: created.value.reportId },
    });
  });

  it("edits body only, leaving intent unchanged", async () => {
    const deps = makeDeps();
    await deps.reports.save(report("iiiiiiiiii"));
    const created = await addComment(deps, ownerActor, {
      slug: slug("iiiiiiiiii"),
      body: "original",
      anchor,
      intent: "add",
    });
    if (!created.ok) throw new Error("fixture failed");

    const r = await editComment(deps, ownerActor, {
      slug: slug("iiiiiiiiii"),
      commentId: created.value.id,
      body: "just the body",
    });
    expect(r.ok && r.value.body).toBe("just the body");
    expect(r.ok && r.value.intent).toBe("add"); // unchanged
  });

  it("rejects an org member who is neither the author nor the owner with NotAllowed", async () => {
    const deps = makeDeps();
    await deps.reports.save(report("bbbbbbbbbb"));
    const created = await addComment(deps, ownerActor, {
      slug: slug("bbbbbbbbbb"),
      body: "root",
      anchor,
    });
    if (!created.ok) throw new Error("fixture failed");

    const r = await editComment(
      deps,
      { orgId: orgA, userId: bystander },
      { slug: slug("bbbbbbbbbb"), commentId: created.value.id, body: "hijack" },
    );
    expect(!r.ok && r.error.kind).toBe("NotAllowed");
    // untouched
    const reloaded = await deps.comments.findById(created.value.id);
    expect(reloaded.ok && reloaded.value?.body).toBe("root");
  });

  it("rejects an invalid intent with a ValidationError (via the domain VO)", async () => {
    const deps = makeDeps();
    await deps.reports.save(report("jjjjjjjjjj"));
    const created = await addComment(deps, ownerActor, {
      slug: slug("jjjjjjjjjj"),
      body: "root",
      anchor,
    });
    if (!created.ok) throw new Error("fixture failed");

    const r = await editComment(deps, ownerActor, {
      slug: slug("jjjjjjjjjj"),
      commentId: created.value.id,
      // biome-ignore lint/suspicious/noExplicitAny: exercising a boundary-invalid intent
      intent: "bogus" as any,
    });
    expect(!r.ok && r.error.kind).toBe("ValidationError");
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

    const r = await editComment(deps, ownerActor, {
      slug: slug("dddddddddd"),
      commentId: elsewhere.value.id,
      body: "x",
    });
    expect(!r.ok && r.error.kind).toBe("NotFound");
  });

  it("lets a cross-org write-grantee edit their OWN comment outside the report's org (ADR-0060 §4)", async () => {
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

    const created = await addComment(deps, granteeActor, {
      slug: slug("hhhhhhhhhh"),
      body: "a grantee's comment",
      anchor,
    });
    if (!created.ok) throw new Error("fixture failed");

    const edited = await editComment(deps, granteeActor, {
      slug: slug("hhhhhhhhhh"),
      commentId: created.value.id,
      body: "grantee edits their own",
    });
    expect(edited.ok).toBe(true);
    expect(edited.ok && edited.value.body).toBe("grantee edits their own");
  });
});
