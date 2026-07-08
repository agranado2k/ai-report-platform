// GET /reports/{slug}/diff?from=N&to=N — the visual diff between two of a
// report's versions (ADR-0065 §3/§4). Loads both versions' HTML (+ optional
// `_source.json` sidecar) from R2 and renders:
//   - a structural, word-level diff (arp-report-html's diffRendered) when
//     BOTH sides carry a sidecar that parses and conforms to reportSchema
//     (the common case for an editor-touched report), or
//   - a labeled, lower-fidelity block-level fallback (diffHtmlFallback)
//     otherwise — either side lacking a sidecar (e.g. an externally-uploaded
//     version never opened in the editor), or a sidecar that's present but
//     corrupt (truncated/non-conforming JSON) — ADR-0065 §3's explicit
//     "never mistaken for the structured diff" requirement, AND a corrupt
//     sidecar must degrade gracefully rather than 500 the page (PR #156
//     review, Fix 2). The parse-or-render-then-fall-back decision itself is
//     `computeReportDiff` (report-diff.server.ts), unit-tested there since
//     this route isn't (no route-level test convention in this repo).
//
// Auth: getReport's loadReadableReport guard directly (PR #156 review, Fix
// 3) — NOT loadReportForVersionsRead. That helper runs listReportVersions's
// narrower org-scoped guard first only because the version-history page
// (reports.$slug.versions.tsx) needs its VersionPage projection; this route
// reads `report.versions` straight off the Report aggregate getReport
// already returns, so the listReportVersions call was a pure double-fetch —
// getReport's guard is a strict superset (see report-versions.server.ts's
// own comment on that superset relationship), so auth is unchanged.
//
// RENDERING CHOICE: the diff HTML is the report's EDITABLE BODY ONLY (the
// shell/body split, ADR-0062 §2) — never re-wrapped in the report's own
// presentation shell (`<head>`/`<style>`). The shell is a full standalone
// HTML document (its own fonts, layout, design tokens); embedding it here
// would fight the dashboard's own page chrome and CSP. Instead the body
// fragment is rendered directly inside this page with a small neutral
// stylesheet (`.report-diff-body` + `.rd-diff-*` rules in styles/theme.css)
// just enough to make prose readable and diff markers legible.
import { json, type LoaderFunctionArgs, redirect } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { getReport } from "arp-application";
import { makeSlug } from "arp-domain";
import { splitShell } from "arp-report-html";
import { AppHeader, buttonClass, Card, PageShell } from "../components";
import { resolveActorForRead } from "../server/auth.server";
import { deps, identityStore, writeGrantStore } from "../server/container.server";
import { computeReportDiff } from "../server/report-diff.server";

function parseVersionNo(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function loader(args: LoaderFunctionArgs) {
  const actorR = await resolveActorForRead(args);
  if (!actorR.ok || !actorR.value) return redirect("/sign-in");
  const actor = actorR.value;

  const slugR = makeSlug(String(args.params.slug ?? ""));
  if (!slugR.ok) return redirect("/");

  const url = new URL(args.request.url);
  const fromNo = parseVersionNo(url.searchParams.get("from"));
  const toNo = parseVersionNo(url.searchParams.get("to"));
  if (fromNo === null || toNo === null) return redirect(`/reports/${slugR.value}/versions`);

  const reportR = await getReport(
    { reports: deps().reports, grants: writeGrantStore(), identities: identityStore() },
    actor,
    { slug: slugR.value },
  );
  if (!reportR.ok) return redirect("/"); // never reveal existence to a non-authorized actor
  const report = reportR.value;

  const fromVersion = report.versions.find((v) => v.versionNo === fromNo);
  const toVersion = report.versions.find((v) => v.versionNo === toNo);
  if (!fromVersion || !toVersion) return redirect(`/reports/${report.slug}/versions`);

  const [fromHtmlR, toHtmlR, fromSidecarR, toSidecarR] = await Promise.all([
    deps().blobs.readObject(report.id, fromVersion.id, fromVersion.manifest.entryDocument),
    deps().blobs.readObject(report.id, toVersion.id, toVersion.manifest.entryDocument),
    deps().blobs.readObject(report.id, fromVersion.id, "_source.json"),
    deps().blobs.readObject(report.id, toVersion.id, "_source.json"),
  ]);

  if (!fromHtmlR.ok || !fromHtmlR.value || !toHtmlR.ok || !toHtmlR.value) {
    return redirect(`/reports/${report.slug}/versions`);
  }

  const fromBodyHtml = splitShell(new TextDecoder().decode(fromHtmlR.value.bytes)).bodyHtml;
  const toBodyHtml = splitShell(new TextDecoder().decode(toHtmlR.value.bytes)).bodyHtml;

  const fromSidecar = fromSidecarR.ok ? fromSidecarR.value : null;
  const toSidecar = toSidecarR.ok ? toSidecarR.value : null;

  const diff = computeReportDiff({
    fromBodyHtml,
    toBodyHtml,
    fromSidecarBytes: fromSidecar?.bytes ?? null,
    toSidecarBytes: toSidecar?.bytes ?? null,
  });

  return json({
    slug: report.slug,
    title: report.title,
    fromNo,
    toNo,
    mode: diff.mode,
    html: diff.html,
    label: diff.label,
  });
}

export default function ReportDiff() {
  const { slug, title, fromNo, toNo, mode, html, label } = useLoaderData<typeof loader>();

  return (
    <PageShell>
      <AppHeader
        title={`Comparing v${fromNo} → v${toNo} — "${title}"`}
        actions={
          <Link to={`/reports/${slug}/versions`} className={buttonClass("secondary")}>
            ← Version history
          </Link>
        }
      />
      {mode === "fallback" && label ? (
        <p className="mb-4 rounded-control border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          {label}
        </p>
      ) : null}
      <Card className="p-6">
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: this is our
            OWN diffRendered/diffHtmlFallback output (arp-report-html), not
            unsanitized user HTML passed through verbatim — both diff
            functions only ever emit markup derived from reportSchema's
            already-sanitized node/mark set (diffDocs/diffRendered) or escaped
            block text (diffHtmlFallback's <div> wrappers around whole,
            already-served blocks). Rendered on the APP origin deliberately:
            it's diagnostic chrome around a report's own content, not a
            replacement for the sandboxed viewer (ADR-002/0038). */}
        <div className="report-diff-body" dangerouslySetInnerHTML={{ __html: html }} />
      </Card>
    </PageShell>
  );
}
