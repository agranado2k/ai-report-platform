// Domain events at the Report aggregate boundary (ADR-0036). Names are the
// contract (docs/events.md). ReportVersionUploaded + ReportPublished are
// emitted by Reports & Folders; ReportVersionScanned is emitted by Abuse &
// Moderation and consumed here (applyScanResult) to update the scan cache and
// drive promotion. CommentAdded/CommentResolved (below) are emitted at the
// `Comment` aggregate boundary — Authoring & Collaboration (ADR-0064).

import type { CommentId, ReportId, UserId, VersionId } from "./brand";
import type { TerminalScanStatus, VersionOrigin } from "./value-objects";

export interface ReportVersionUploaded {
  readonly type: "ReportVersionUploaded";
  readonly reportId: ReportId;
  readonly versionId: VersionId;
  readonly versionNo: number;
  /** ADR-0062 §6 — audit/analytics only, no consumer behavior change. */
  readonly origin: VersionOrigin;
}

export interface ReportVersionScanned {
  readonly type: "ReportVersionScanned";
  readonly reportId: ReportId;
  readonly versionId: VersionId;
  readonly verdict: TerminalScanStatus;
}

export interface ReportPublished {
  readonly type: "ReportPublished";
  readonly reportId: ReportId;
  readonly versionId: VersionId;
  readonly firstPublish: boolean;
}

/** Emitted on `Comment` creation, root or reply (ADR-0064 §6). Reserved for
 *  future Reports & Folders notification/audit fan-out — no consumer wired yet;
 *  delivered via the existing transactional outbox like every other event. */
export interface CommentAdded {
  readonly type: "CommentAdded";
  readonly commentId: CommentId;
  readonly reportId: ReportId;
  readonly authorUserId: UserId;
  /** null = a root comment; set = a reply to that root (ADR-0064 Decision 2). */
  readonly parentCommentId: CommentId | null;
}

/** Emitted when a `Comment` is resolved (ADR-0064 §6). Same outbox delivery,
 *  no new transport. */
export interface CommentResolved {
  readonly type: "CommentResolved";
  readonly commentId: CommentId;
  readonly reportId: ReportId;
  readonly resolvedAt: number;
}

export type DomainEvent =
  | ReportVersionUploaded
  | ReportVersionScanned
  | ReportPublished
  | CommentAdded
  | CommentResolved;
