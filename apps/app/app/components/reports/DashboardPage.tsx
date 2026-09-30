import { Link } from "@remix-run/react";
import { AppHeader, buttonClass, cx, EmptyState, PageShell } from "..";
import { type FolderManageNode, FolderManagePanel } from "../folders/FolderManagePanel";
import { NewFolderDialog } from "../folders/NewFolderDialog";
import type { ReportSharingChoice } from "../ReportSharingMenu";
import { ReportFilter } from "./ReportFilter";
import { ReportRow, type ReportRowItem } from "./ReportRow";

// The dashboard body (ADR-0036, Reports & Folders), extracted from the
// `_app._index` route so it is prop-driven: the route keeps the loader, the
// action and the narrowing of `useActionData()`, and hands this component plain
// data. That is what lets the browser tier (ADR-0079, app-component amendment)
// mount the PRODUCTION composition instead of a hand-copied layout.

/** The dashboard's per-folder shape (ADR-0087): the cheap, tree-derived facts
 *  the content-header panel and the Move control need. The roster, the
 *  roster-derived badge count and the bulk-apply count are loaded lazily by the
 *  panel, not here. */
export type DashboardFolder = FolderManageNode & { readonly parentId: string | null };

/** One Report in the list — the row's shape plus the wire id the cursor links use. */
export type DashboardReport = ReportRowItem & { readonly id: string };

/** A report-sharing action's outcome, tagged with the Report it belongs to
 *  (ADR-0078 §12). See the route's `ReportActionData`. */
export interface ReportOutcome {
  readonly reportSlug: string;
  readonly error: string | null;
  readonly summary: string | null;
  readonly pendingSharing: string | null;
}

export interface DashboardPageProps {
  readonly folders: readonly DashboardFolder[];
  readonly items: readonly DashboardReport[];
  readonly hasPrev: boolean;
  readonly hasNext: boolean;
  readonly q: string;
  readonly selectedFolderId: string | null;
  readonly rootId: string | null;
  readonly inertShareNotice: string;
  readonly rosterUnavailableNotice: string;
  readonly sharingChoices: readonly ReportSharingChoice[];
  readonly personShareLimitNotice: string;
  /** The last report-sharing outcome, or null. */
  readonly reportOutcome: ReportOutcome | null;
  /** A refused new-folder create, echoed back so the dialog re-opens, or null. */
  readonly newFolderError: string | null;
}

export function DashboardPage({
  folders,
  items,
  hasPrev,
  hasNext,
  q,
  selectedFolderId,
  rootId,
  inertShareNotice,
  rosterUnavailableNotice,
  sharingChoices,
  personShareLimitNotice,
  reportOutcome,
  newFolderError,
}: DashboardPageProps) {
  // Plain lookup: the loader has already resolved every id the UI binds to
  // down to a folder that is actually in `folders` (see `displayFolderId`).
  const folderName = (id: string) => folders.find((f) => f.id === id)?.name ?? "—";
  const createParent = selectedFolderId ?? rootId;
  const scopeLabel = selectedFolderId ? folderName(selectedFolderId) : "All reports";
  // The selected folder's management node (ADR-0087) — the content-header panel
  // renders for it; no selection (or Root) shows just the filter + report list.
  const selectedFolder = selectedFolderId
    ? (folders.find((f) => f.id === selectedFolderId) ?? null)
    : null;

  // Cursor links (ADR-0053) preserve the active search + folder filter; the cursor
  // is the boundary report id (forward = starting_after, back = ending_before).
  const cursorHref = (cursor?: { starting_after?: string; ending_before?: string }) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (selectedFolderId) sp.set("folder", selectedFolderId);
    if (cursor?.starting_after) sp.set("starting_after", cursor.starting_after);
    if (cursor?.ending_before) sp.set("ending_before", cursor.ending_before);
    const s = sp.toString();
    return s ? `/?${s}` : "/";
  };

  return (
    <PageShell>
      <AppHeader title="Your reports" />

      {/* Filter-as-you-type (#334): debounced ?q= navigation, no submit; "/"
          focuses it. The folder filter is preserved and the cursor resets
          (report-filter.ts). */}
      <div className="mb-6 flex items-center gap-2">
        <ReportFilter defaultQuery={q} />
      </div>

      {/* The folder-navigation rail now lives in the `_app` shell (ADR-0087);
          the dashboard body is the report list, headed — when a folder is
          selected — by its content-header management panel. The panel renders
          nothing for Root or a non-selection. */}
      <div className="min-w-0">
        {selectedFolder ? (
          <FolderManagePanel
            node={selectedFolder}
            inertShareNotice={inertShareNotice}
            rosterUnavailableNotice={rosterUnavailableNotice}
            personShareLimitNotice={personShareLimitNotice}
          />
        ) : null}

        <section className="min-w-0">
          <p className="mb-3 text-sm text-muted">
            <span className="font-medium text-fg">{scopeLabel}</span>
            {q ? ` · matching “${q}”` : ""} · {items.length}
            {hasNext ? "+" : ""} report{items.length === 1 && !hasNext ? "" : "s"}
          </p>
          {reportOutcome ? (
            <p
              role="status"
              className={cx(
                "mb-3 rounded-control px-2 py-1.5 text-xs",
                reportOutcome.error ? "bg-danger/10 text-danger" : "bg-success/12 text-success",
              )}
            >
              <span className="font-medium">{reportOutcome.reportSlug}: </span>
              {reportOutcome.error ?? reportOutcome.summary}
            </p>
          ) : null}
          {items.length === 0 ? (
            <EmptyState
              icon="🗂️"
              title={q ? "No matching reports" : "No reports here yet"}
              description={
                q
                  ? "Try a different search term or clear the filter."
                  : "Upload a report to get started."
              }
              action={
                q ? undefined : (
                  <Link to="/upload" className={cx(buttonClass("primary"), "max-md:h-11")}>
                    Upload a report
                  </Link>
                )
              }
            />
          ) : (
            // Not `overflow-hidden`: an open row menu must extend past the list
            // rather than be clipped by it (#403).
            <div className="rounded-card border border-border">
              {/* Visual column header; the rows below are a real <ul>/<li> so
                  list semantics (lost when T4a replaced the <ul> with a div
                  grid — #346) are restored. A full ARIA table with column
                  association is the interaction ticket's call (#347). */}
              <div
                aria-hidden="true"
                className="hidden grid-cols-[minmax(0,1fr)_7rem_auto_2.5rem] items-center gap-3 rounded-t-card border-b border-border bg-bg px-3 py-2 text-xs font-medium text-muted md:grid"
              >
                <span>Name</span>
                <span>Status</span>
                <span>Sharing</span>
                <span className="sr-only">Actions</span>
              </div>
              <ul className="list-none">
                {items.map((r) => (
                  <ReportRow
                    key={r.slug}
                    report={r}
                    folders={folders}
                    folderLabel={folderName(r.displayFolderId)}
                    sharingChoices={sharingChoices}
                    pendingSharing={
                      reportOutcome?.reportSlug === r.slug
                        ? (reportOutcome.pendingSharing ?? null)
                        : null
                    }
                  />
                ))}
              </ul>
            </div>
          )}

          {hasPrev || hasNext ? (
            <div className="mt-4 flex items-center gap-3 text-sm [&>*]:inline-flex [&>*]:min-h-11 [&>*]:items-center md:[&>*]:min-h-0">
              {hasPrev ? (
                <Link
                  to={cursorHref(items[0] ? { ending_before: items[0].id } : undefined)}
                  className="text-brand hover:text-brand-hover"
                >
                  ← Prev
                </Link>
              ) : (
                <span className="text-subtle">← Prev</span>
              )}
              {hasNext ? (
                <Link
                  to={cursorHref(
                    items.length ? { starting_after: items[items.length - 1]?.id } : undefined,
                  )}
                  className="text-brand hover:text-brand-hover"
                >
                  Next →
                </Link>
              ) : (
                <span className="text-subtle">Next →</span>
              )}
            </div>
          ) : null}

          {createParent ? (
            // Creating a folder gets a deliberate dialog step (#336, report §02)
            // — the inline field became the "New folder" dialog, also reachable
            // from the ⌘K palette. It posts the SAME `new-folder` intent the
            // action (and the e2e suite) already drive. A REFUSED create echoes
            // its error back here; the dialog re-opens with the rejected name to
            // fix.
            <div className="mt-6">
              <NewFolderDialog
                key={`new-folder-${folders.length}`}
                parentId={createParent}
                parentLabel={selectedFolderId ? scopeLabel : "Root"}
                error={newFolderError}
              />
            </div>
          ) : null}
        </section>
      </div>
    </PageShell>
  );
}
