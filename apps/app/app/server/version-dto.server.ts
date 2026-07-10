// Version-summary → client DTO mapping + author-email enrichment (Phase 1
// "surface version authorship"). `ReportVersionSummary.uploadedBy` already
// carries the author's UserId (packages/application/src/ports.ts) — the
// versions route loader was projecting every OTHER field but silently
// dropping it. This module mirrors comment-dto.server.ts's split: dedupe the
// author ids across a page of versions (ONE IdentityStore.findEmailByUserId
// round-trip per unique author, not per version — same shape as the edit
// route's comment-author enrichment), then map the resolved emails back onto
// each version DTO. A lookup miss (deleted user, never-mirrored identity) is
// never a hard failure here — it just yields `authorEmail: null`; the route
// decides the display fallback (never a security-relevant field, versions
// are already gated to actors with report access, same posture as comments).
import type { ReportVersionSummary } from "arp-application";
import type { ScanStatus, UserId, VersionId, VersionOrigin } from "arp-domain";

export interface VersionListItemDto {
  readonly versionNo: number;
  readonly uploadedAt: number;
  readonly scanStatus: ScanStatus;
  readonly origin: VersionOrigin;
  readonly sizeBytes: number;
  readonly isLive: boolean;
  readonly authorEmail: string | null;
}

/** The unique author ids across a page of versions, in first-seen order —
 *  callers look each one up via IdentityStore.findEmailByUserId ONCE, then
 *  pass the resulting id→email map into `versionsToDto`. */
export function uniqueVersionAuthorIds(
  versions: readonly Pick<ReportVersionSummary, "uploadedBy">[],
): readonly UserId[] {
  return [...new Set(versions.map((v) => v.uploadedBy))];
}

/** Projects each `ReportVersionSummary` into the route's wire shape, folding
 *  in `isLive` (a match against the report's `liveVersionId`) and
 *  `authorEmail` (looked up in `emailByAuthor`, built from
 *  `uniqueVersionAuthorIds` + IdentityStore — a missing entry OR an entry
 *  resolved to `null` both fall back to `authorEmail: null` identically). */
export function versionsToDto(
  versions: readonly ReportVersionSummary[],
  liveVersionId: VersionId | null,
  emailByAuthor: ReadonlyMap<UserId, string | null>,
): readonly VersionListItemDto[] {
  return versions.map((v) => ({
    versionNo: v.versionNo,
    uploadedAt: v.uploadedAt,
    scanStatus: v.scanStatus,
    origin: v.origin,
    sizeBytes: v.sizeBytes,
    isLive: liveVersionId !== null && liveVersionId === v.id,
    authorEmail: emailByAuthor.get(v.uploadedBy) ?? null,
  }));
}
