// DrizzleCommentRepository — persists the Comment aggregate against the
// `comments` table (ADR-0020, ADR-0064). Row<->domain mapping is a pure
// function (unit-testable); queries are contract-tested against pglite
// (ADR-0046), the same shared CommentRepository suite that runs against
// InMemoryCommentRepository (packages/application/src/testing/contracts).
import type { CommentPage, CommentRepository, CursorParams } from "arp-application";
import { comments } from "arp-db/schema";
import {
  type Anchor,
  type AppError,
  type Comment,
  type CommentId,
  commentId,
  intentOrDefault,
  ok,
  type ReportId,
  type Result,
  reportId,
  userId,
} from "arp-domain";
import { and, asc, desc, eq, gt, lt } from "drizzle-orm";
import type { DbContext } from "./client";

type CommentRow = typeof comments.$inferSelect;

export function rowToComment(row: CommentRow): Comment {
  return {
    id: commentId(row.id),
    reportId: reportId(row.reportId),
    authorUserId: userId(row.authorUserId),
    body: row.body,
    // A legacy row (pre-`intent` column, or a null slipped in) degrades to
    // `note` (intentOrDefault) — the read never fails on it.
    intent: intentOrDefault(row.intent),
    anchor: row.anchorJson as Anchor,
    parentCommentId: row.parentCommentId === null ? null : commentId(row.parentCommentId),
    // A legacy row (pre-`edited_at` column) reads back NULL → never edited.
    editedAt: row.editedAt === null ? null : row.editedAt.getTime(),
    resolvedAt: row.resolvedAt === null ? null : row.resolvedAt.getTime(),
    createdAt: row.createdAt.getTime(),
  };
}

function commentToRow(c: Comment): typeof comments.$inferInsert {
  return {
    id: c.id,
    reportId: c.reportId,
    authorUserId: c.authorUserId,
    parentCommentId: c.parentCommentId,
    body: c.body,
    intent: c.intent,
    anchorJson: c.anchor,
    editedAt: c.editedAt === null ? null : new Date(c.editedAt),
    resolvedAt: c.resolvedAt === null ? null : new Date(c.resolvedAt),
  };
}

export class DrizzleCommentRepository implements CommentRepository {
  constructor(private readonly ctx: DbContext) {}

  async findById(id: CommentId): Promise<Result<Comment | null, AppError>> {
    try {
      const db = this.ctx.current();
      const [row] = await db.select().from(comments).where(eq(comments.id, id)).limit(1);
      return ok(row ? rowToComment(row) : null);
    } catch (e) {
      return errUnexpected("findComment", e);
    }
  }

  async save(comment: Comment): Promise<Result<void, AppError>> {
    try {
      const db = this.ctx.current();
      // Insert, or update the mutable fields on conflict by id (resolve →
      // resolvedAt; edit → body/intent/editedAt).
      await db
        .insert(comments)
        .values(commentToRow(comment))
        .onConflictDoUpdate({
          target: comments.id,
          set: {
            body: comment.body,
            intent: comment.intent,
            anchorJson: comment.anchor,
            editedAt: comment.editedAt === null ? null : new Date(comment.editedAt),
            resolvedAt: comment.resolvedAt === null ? null : new Date(comment.resolvedAt),
          },
        });
      return ok(undefined);
    } catch (e) {
      return errUnexpected("saveComment", e);
    }
  }

  async listByReport(
    reportIdVal: ReportId,
    q: CursorParams<CommentId>,
  ): Promise<Result<CommentPage, AppError>> {
    // Cursor pagination (ADR-0053): keyset on the comment id (UUIDv7), DESC =
    // newest-created first — same shape as listVersions (report-repository.ts).
    try {
      const db = this.ctx.current();
      const filters = [eq(comments.reportId, reportIdVal)];
      const back = q.endingBefore !== undefined;
      if (q.startingAfter) filters.push(lt(comments.id, q.startingAfter));
      if (q.endingBefore) filters.push(gt(comments.id, q.endingBefore));

      const rows = await db
        .select()
        .from(comments)
        .where(and(...filters))
        .orderBy(back ? asc(comments.id) : desc(comments.id))
        .limit(q.limit + 1); // +1 to detect has_more

      const hasMore = rows.length > q.limit;
      const slice = rows.slice(0, q.limit);
      const page = back ? slice.reverse() : slice;
      return ok({ items: page.map(rowToComment), hasMore });
    } catch (e) {
      return errUnexpected("listCommentsByReport", e);
    }
  }

  async delete(id: CommentId): Promise<Result<void, AppError>> {
    try {
      const db = this.ctx.current();
      // The self-FK (comments.parent_comment_id → comments) is ON DELETE CASCADE
      // (schema.ts's FK-policy note) — deleting a root deletes its replies too.
      await db.delete(comments).where(eq(comments.id, id));
      return ok(undefined);
    } catch (e) {
      return errUnexpected("deleteComment", e);
    }
  }
}

function errUnexpected(op: string, e: unknown): Result<never, AppError> {
  return {
    ok: false,
    error: { kind: "Unexpected", message: `${op}: ${e instanceof Error ? e.message : String(e)}` },
  };
}
