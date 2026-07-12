// Author-id deduplication for a page of version summaries (Phase 1 "surface
// version authorship"). `ReportVersionSummary.uploadedBy` carries the author's
// UserId (packages/application/src/ports.ts); callers dedupe those ids so the
// route makes ONE IdentityStore.findEmailByUserId round-trip per unique author
// (not per version — same shape as the edit route's comment-author
// enrichment). A lookup miss (deleted user, never-mirrored identity) is a
// route-level concern, never a hard failure — versions are already gated to
// actors with report access, same posture as comments.
import type { ReportVersionSummary } from "arp-application";
import type { UserId } from "arp-domain";

/** The unique author ids across a page of versions, in first-seen order —
 *  callers look each one up via IdentityStore.findEmailByUserId ONCE. */
export function uniqueVersionAuthorIds(
  versions: readonly Pick<ReportVersionSummary, "uploadedBy">[],
): readonly UserId[] {
  return [...new Set(versions.map((v) => v.uploadedBy))];
}
