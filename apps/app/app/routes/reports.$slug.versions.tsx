// GET /reports/{slug}/versions — the version-history discovery page (ADR-0065
// §1/§3): lists a report's ReportVersions (newest-created first) with
// version_no, uploaded_at, scan_status, origin, and per-version actions
// ("view" on the viewer origin; "compare with previous" -> the diff view).
//
// Auth mirrors GET /api/v1/reports/{slug}/versions EXACTLY (loadReportForVersionsRead
// runs listReportVersions's org-scoped loadOrgReport guard first) — a report
// outside the actor's org reads as "redirect home", same fail-closed, never-
// reveal-existence posture as reports.$slug.edit.tsx.
//
// Scope: a single page of up to 100 versions (no cursor UI) — the common case
// for a report's history; `hasMore` is surfaced as a note rather than wired to
// full pagination, which this ADR doesn't require for v1.
import { json, type LoaderFunctionArgs, redirect } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import type { ScanStatus, VersionOrigin } from "arp-domain";
import { makeSlug } from "arp-domain";
import { AppHeader, Badge, type BadgeTone, buttonClass, Card, PageShell } from "../components";
import { resolveActorForRead } from "../server/auth.server";
import { identityStore, viewOrigin } from "../server/container.server";
import { loadReportForVersionsRead } from "../server/report-versions.server";
import { uniqueVersionAuthorIds, versionsToDto } from "../server/version-dto.server";

const MAX_VERSIONS_SHOWN = 100;

const SCAN_TONE: Record<ScanStatus, BadgeTone> = {
  pending: "warning",
  clean: "success",
  flagged: "danger",
  blocked: "danger",
};

const ORIGIN_TONE: Record<VersionOrigin, BadgeTone> = {
  upload: "neutral",
  editor: "brand",
};

/** Locale-independent, so server-render and client hydration always agree. */
function formatUploadedAt(epochMs: number): string {
  return `${new Date(epochMs).toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

export async function loader(args: LoaderFunctionArgs) {
  const actorR = await resolveActorForRead(args);
  if (!actorR.ok || !actorR.value) return redirect("/sign-in");
  const actor = actorR.value;

  const slugR = makeSlug(String(args.params.slug ?? ""));
  if (!slugR.ok) return redirect("/");

  const guarded = await loadReportForVersionsRead(actor, slugR.value, {
    limit: MAX_VERSIONS_SHOWN,
  });
  if (!guarded.ok) return redirect("/"); // never reveal existence to a non-authorized actor

  const { report, versions } = guarded.value;

  // Best-effort author email enrichment (IdentityStore.findEmailByUserId) —
  // one lookup per UNIQUE author, not per version; mirrors the edit route's
  // comment-author enrichment (reports.$slug.edit.tsx). A failed/missing
  // lookup falls back to `authorEmail: null` (versionsToDto), and the render
  // below picks the display fallback.
  const uniqueAuthorIds = uniqueVersionAuthorIds(versions.items);
  const emailEntries = await Promise.all(
    uniqueAuthorIds.map(async (id) => {
      const emailResult = await identityStore().findEmailByUserId(id);
      return [id, emailResult.ok ? emailResult.value : null] as const;
    }),
  );
  const emailByAuthor = new Map(emailEntries);

  return json({
    slug: report.slug,
    title: report.title,
    viewOrigin: viewOrigin(args.request),
    hasMore: versions.hasMore,
    versions: versionsToDto(versions.items, report.liveVersionId, emailByAuthor),
  });
}

export default function ReportVersions() {
  const { slug, title, viewOrigin: origin, versions, hasMore } = useLoaderData<typeof loader>();

  return (
    <PageShell>
      <AppHeader
        title={`Version history — "${title}"`}
        actions={
          <Link to="/" className={buttonClass("secondary")}>
            ← Back to reports
          </Link>
        }
      />
      <p className="mb-4 text-xs text-subtle">
        <code className="font-mono">{slug}</code> · {versions.length} version
        {versions.length === 1 ? "" : "s"}
        {hasMore ? ` (showing the ${MAX_VERSIONS_SHOWN} most recent)` : ""}
      </p>

      <Card className="divide-y divide-border">
        {versions.map((v, i) => {
          const previous = versions[i + 1];
          return (
            <div
              key={v.versionNo}
              className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="font-mono text-fg">v{v.versionNo}</span>
                {v.isLive ? <Badge tone="brand">Live</Badge> : null}
                <Badge tone={ORIGIN_TONE[v.origin]}>{v.origin}</Badge>
                <Badge tone={SCAN_TONE[v.scanStatus]}>{v.scanStatus}</Badge>
                <span className="text-subtle">{formatUploadedAt(v.uploadedAt)}</span>
                <span className="min-w-0 truncate text-xs text-subtle">
                  edited by {v.authorEmail ?? "unknown author"}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {/* Cross-origin to view.<domain> (ADR-002/0038). NOTE: the
                    viewer currently always serves the LIVE version regardless
                    of `?v=` — ADR-0065 §5 says ?v=N is "unchanged", but as of
                    this slice the viewer loader (apps/view/app/routes/$slug.tsx)
                    has no version-selection logic at all, so this link is
                    forward-compatible with the documented contract rather than
                    functional today for non-live versions. Flagged, not fixed
                    here: apps/view is out of scope for this change. */}
                <a
                  href={`${origin}/${slug}?v=${v.versionNo}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand hover:text-brand-hover"
                >
                  View
                </a>
                {previous ? (
                  <Link
                    to={`/reports/${slug}/diff?from=${previous.versionNo}&to=${v.versionNo}`}
                    className="text-brand hover:text-brand-hover"
                  >
                    Compare with previous
                  </Link>
                ) : (
                  <span className="text-subtle">First version</span>
                )}
              </div>
            </div>
          );
        })}
      </Card>
    </PageShell>
  );
}
