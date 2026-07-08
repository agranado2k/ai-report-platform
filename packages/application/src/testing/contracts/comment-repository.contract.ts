// Shared CommentRepository contract (ADR-0020 port, ADR-0064, ADR-0046 two-tier
// testing). Run against both InMemoryCommentRepository and
// DrizzleCommentRepository-on-pglite so the fake's cascade-delete emulation
// stays honest against the real DB's self-FK ON DELETE CASCADE
// (comments.parent_comment_id → comments, schema.ts's FK-policy note).
import type { AppError, Comment, CommentId, ReportId, Result, UserId } from "arp-domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommentRepository } from "../../ports";

export interface CommentRepositoryContractHarness {
  readonly repo: CommentRepository;
  readonly reportId: ReportId;
  /** A second, distinct report id already valid for this harness's FKs — for
   *  asserting listByReport scopes to one report. */
  readonly otherReportId: ReportId;
  readonly authorUserId: UserId;
  /** A fresh, valid root Comment (or reply, via `parentCommentId`) under the
   *  harness's report — id/body auto-generated and overridable. Does NOT save
   *  it; the test calls `repo.save()`. */
  makeComment(overrides?: {
    readonly id?: CommentId;
    readonly reportId?: ReportId;
    readonly parentCommentId?: CommentId | null;
    readonly authorUserId?: UserId;
    readonly body?: string;
  }): Comment;
  teardown(): Promise<void>;
}

export function describeCommentRepositoryContract(
  label: string,
  setup: () => Promise<CommentRepositoryContractHarness>,
): void {
  describe(`CommentRepository contract (${label})`, () => {
    let h: CommentRepositoryContractHarness;

    beforeEach(async () => {
      h = await setup();
    });
    afterEach(async () => {
      await h.teardown();
    });

    it("saves a comment and finds it by id", async () => {
      const comment = h.makeComment({ body: "What does this mean?" });
      expect((await h.repo.save(comment)).ok).toBe(true);

      const found = await h.repo.findById(comment.id);
      expect(found.ok && found.value?.body).toBe("What does this mean?");
      expect(found.ok && found.value?.reportId).toBe(h.reportId);
    });

    it("findById resolves an unknown id to null (not an error)", async () => {
      const found = await h.repo.findById(h.makeComment().id);
      expect(found).toEqual({ ok: true, value: null });
    });

    it("save() upserts by id — re-saving (e.g. a resolve) updates in place", async () => {
      const comment = h.makeComment();
      await h.repo.save(comment);
      const resolved: Comment = { ...comment, resolvedAt: 1234 };
      await h.repo.save(resolved);

      const found = await h.repo.findById(comment.id);
      expect(found.ok && found.value?.resolvedAt).toBe(1234);
    });

    it("listByReport returns a report's comments newest-created first", async () => {
      const older = h.makeComment({ body: "first" });
      const newer = h.makeComment({ body: "second" });
      await h.repo.save(older);
      await h.repo.save(newer);

      const page = await h.repo.listByReport(h.reportId, { limit: 10 });
      expect(page.ok).toBe(true);
      if (!page.ok) return;
      expect(page.value.items.map((c) => c.id)).toEqual([newer.id, older.id]);
      expect(page.value.hasMore).toBe(false);
    });

    it("listByReport scopes to one report — another report's comments are excluded", async () => {
      const here = h.makeComment({ reportId: h.reportId });
      const elsewhere = h.makeComment({ reportId: h.otherReportId });
      await h.repo.save(here);
      await h.repo.save(elsewhere);

      const page = await h.repo.listByReport(h.reportId, { limit: 10 });
      expect(page.ok && page.value.items.map((c) => c.id)).toEqual([here.id]);
    });

    it("listByReport keyset-paginates newest-created first, honoring startingAfter", async () => {
      const comments = [h.makeComment(), h.makeComment(), h.makeComment()];
      for (const c of comments) await h.repo.save(c);

      const page1 = await h.repo.listByReport(h.reportId, { limit: 2 });
      expect(page1.ok && page1.value.items).toHaveLength(2);
      expect(page1.ok && page1.value.hasMore).toBe(true);

      const cursor = page1.ok ? page1.value.items[1]?.id : undefined;
      const page2 = await h.repo.listByReport(h.reportId, { limit: 2, startingAfter: cursor });
      expect(page2.ok && page2.value.items).toHaveLength(1);
      expect(page2.ok && page2.value.hasMore).toBe(false);
    });

    it("delete removes a comment", async () => {
      const comment = h.makeComment();
      await h.repo.save(comment);
      expect((await h.repo.delete(comment.id)).ok).toBe(true);

      const found = await h.repo.findById(comment.id);
      expect(found.ok && found.value).toBeNull();
    });

    it("deleting a root cascades to its replies (self-FK CASCADE, ADR-0064)", async () => {
      const root = h.makeComment({ body: "root" });
      await h.repo.save(root);
      const reply = h.makeComment({ parentCommentId: root.id, body: "a reply" });
      await h.repo.save(reply);

      const del: Result<void, AppError> = await h.repo.delete(root.id);
      expect(del.ok).toBe(true);

      const foundRoot = await h.repo.findById(root.id);
      expect(foundRoot.ok && foundRoot.value).toBeNull();
      const foundReply = await h.repo.findById(reply.id);
      expect(foundReply.ok && foundReply.value).toBeNull();
    });
  });
}
