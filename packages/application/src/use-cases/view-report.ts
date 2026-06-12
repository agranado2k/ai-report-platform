// resolveViewableReport — the ADR-0038 §2 viewer gate as a pure, testable
// function. Given a (validated) slug, resolve what the viewer should do: serve
// the clean live version, or a reason-opaque non-serve outcome. Pure orchestration
// (no I/O — ADR-0024) over the ReportRepository port (repository pattern, ADR-0020);
// the route maps the outcome to an HTTP response (410 / holding page / 451 / 404 /
// stream) and does the R2 read. Serves the view-origin viewer (apps/view).
//
// Reason-opaque (ADR-0038): unknown slug, blocked content, a missing version, and
// "no live version" all collapse to `notfound` — we never acknowledge serious-bad
// content. Only an infra failure (the repository lookup) surfaces as an AppError.
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
  | { readonly kind: "serve"; readonly report: Report; readonly liveVersion: ReportVersion }
  | { readonly kind: "deleted" } // → 410 Gone
  | { readonly kind: "scanning" } // → 200 holding page
  | { readonly kind: "flagged" } // → 451
  | { readonly kind: "notfound" }; // → 404 (unknown / blocked / no servable version)

export async function resolveViewableReport(
  slug: Slug,
  reports: ReportRepository,
): Promise<Result<ViewOutcome, AppError>> {
  const found = await reports.findBySlug(slug);
  if (!found.ok) return found;
  if (!found.value) return ok({ kind: "notfound" });

  const report = found.value;
  if (report.deletedAt !== null) return ok({ kind: "deleted" });

  if (report.liveVersionId === null) {
    const newest = report.versions[report.versions.length - 1];
    if (!newest) return ok({ kind: "notfound" });
    if (newest.scanStatus === "pending") return ok({ kind: "scanning" });
    if (newest.scanStatus === "flagged") return ok({ kind: "flagged" });
    return ok({ kind: "notfound" }); // blocked or any non-servable state
  }

  const liveVersion = report.versions.find((v) => v.id === report.liveVersionId);
  // Defense-in-depth: the live version is `clean` by the ADR-0037 §8 promotion
  // invariant (live_version_id is only set on a clean scan), but the gate asserts
  // it anyway — if a bug or data-integrity issue ever pointed liveVersionId at a
  // non-clean version, the viewer still refuses to serve untrusted content.
  if (!liveVersion || liveVersion.scanStatus !== "clean") return ok({ kind: "notfound" });
  return ok({ kind: "serve", report, liveVersion });
}
