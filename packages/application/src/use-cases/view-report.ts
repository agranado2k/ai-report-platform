// resolveViewableReport — the ADR-0038 §2/§3 viewer gate as a pure, testable
// function. Given a (validated) slug, resolve what the viewer should do: serve a
// clean ReportVersion, or a reason-opaque non-serve outcome. Pure orchestration
// (no I/O — ADR-0024) over the ReportRepository port (repository pattern, ADR-0020);
// the route maps the outcome to an HTTP response (410 / holding page / 451 / 404 /
// stream) and does the R2 read. Serves the view-origin viewer (apps/view).
//
// Reason-opaque (ADR-0038): unknown slug, blocked content, a missing version, and
// "no live version" all collapse to `notfound` — we never acknowledge serious-bad
// content. Only an infra failure (the repository lookup) surfaces as an AppError.
//
// `requestedVersionNo` (optional 3rd arg) is the ADR-0038 §3 `?v=N` path: "`?v=N`
// passes through the same ACL + the same scan-status state machine as the live
// URL." Concretely — the requested ReportVersion's OWN scan_status is mapped
// through the identical table the live path uses (clean → serve, pending →
// scanning, flagged → 451, blocked/unknown-N → notfound), rather than a bespoke
// ?v=N-only rule. The ACL gate itself is untouched by this function — it lives in
// resolve-access.ts and the route applies it to `report.acl` AFTER this outcome,
// identically whether the outcome came from the live path or ?v=N (same report,
// same acl field either way — there is no separate gate to bypass).
import {
  type AppError,
  ok,
  type Report,
  type ReportVersion,
  type Result,
  type Slug,
} from "arp-domain";
import type { ReportRepository } from "../ports";

export type ViewOutcome =
  | { readonly kind: "serve"; readonly report: Report; readonly version: ReportVersion }
  | { readonly kind: "deleted" } // → 410 Gone
  // Carries the report so the route can enforce the Acl (ADR-0056) BEFORE the
  // holding page — a private report mid-scan must not reveal its existence or
  // scan state to visitors who couldn't view it once clean (dogfood 2026-07-08).
  | { readonly kind: "scanning"; readonly report: Report } // → Acl gate, then 200 holding page
  | { readonly kind: "flagged" } // → 451
  | { readonly kind: "notfound" }; // → 404 (unknown / blocked / no servable version)

export async function resolveViewableReport(
  slug: Slug,
  reports: ReportRepository,
  requestedVersionNo?: number,
): Promise<Result<ViewOutcome, AppError>> {
  const found = await reports.findBySlug(slug);
  if (!found.ok) return found;
  if (!found.value) return ok({ kind: "notfound" });

  const report = found.value;
  // Taken-down is unconditional — an old ordinal doesn't survive a takedown either
  // (ADR-0038 §2's `410` row applies "at any N").
  if (report.deletedAt !== null) return ok({ kind: "deleted" });

  if (requestedVersionNo !== undefined) {
    return ok(resolveRequestedVersion(report, requestedVersionNo));
  }

  if (report.liveVersionId === null) {
    const newest = report.versions[report.versions.length - 1];
    if (!newest) return ok({ kind: "notfound" });
    if (newest.scanStatus === "pending") return ok({ kind: "scanning", report });
    if (newest.scanStatus === "flagged") return ok({ kind: "flagged" });
    return ok({ kind: "notfound" }); // blocked or any non-servable state
  }

  const liveVersion = report.versions.find((v) => v.id === report.liveVersionId);
  // Defense-in-depth: the live version is `clean` by the ADR-0037 §8 promotion
  // invariant (live_version_id is only set on a clean scan), but the gate asserts
  // it anyway — if a bug or data-integrity issue ever pointed liveVersionId at a
  // non-clean version, the viewer still refuses to serve untrusted content.
  if (liveVersion?.scanStatus !== "clean") return ok({ kind: "notfound" });
  return ok({ kind: "serve", report, version: liveVersion });
}

// The ?v=N ordinal → ViewOutcome mapping (ADR-0038 §3). A malformed/out-of-range
// ordinal is reason-opaque `notfound` — same 404 as an unknown slug or a blocked
// version, so a caller can't distinguish "doesn't exist" from "exists but isn't
// servable" or learn the report's true version count by bisecting.
function resolveRequestedVersion(report: Report, requestedVersionNo: number): ViewOutcome {
  if (!Number.isInteger(requestedVersionNo) || requestedVersionNo <= 0) {
    return { kind: "notfound" };
  }
  const version = report.versions.find((v) => v.versionNo === requestedVersionNo);
  if (!version) return { kind: "notfound" };

  switch (version.scanStatus) {
    case "clean":
      return { kind: "serve", report, version };
    case "pending":
      return { kind: "scanning", report };
    case "flagged":
      return { kind: "flagged" };
    default:
      return { kind: "notfound" }; // "blocked" — reason-opaque, same as unknown
  }
}
