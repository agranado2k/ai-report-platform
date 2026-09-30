import { Form } from "@remix-run/react";
import { Badge, Button, cx, FolderIcon, MoreIcon, Select } from "arp-ui";
import type { ComponentProps } from "react";
import { RenameReportForm } from "../RenameReportForm";
import { ReportSharingMenu } from "../ReportSharingMenu";
import { StatusBadge } from "../StatusBadge";
import { DeleteReportDialog } from "./DeleteReportDialog";

// One report row of the dashboard table (#335). Extracted from the route (which
// had no unit seam) so it is prop-driven and node-render smoke-testable, and a
// real <li> so the list semantics T4a's <div> grid dropped (#346) are restored.
// The hover-reveal lives here too. Behaviour is unchanged from T4a (#334) — the
// sharing kebab and the rename/move/delete <details> menu are the same controls;
// the interaction layer (keyboard model, multi-select/bulk, a unified menu, and
// a full ARIA table with column association) is #347.
//
// Mobile first (#403): below `md` a row is two lines — the Report (title
// wrapping in full, slug, Folder, notices) above its status, sharing and
// actions — and every control is a 44px target. From `md` it is the four
// scannable columns, with the actions revealed on hover where the device can
// hover. Hover never gates an action on a touch screen.

/** Where the row actions hide until hover: a wide screen whose pointer can
 *  hover. Everywhere else they are simply visible. */
const HOVER_REVEAL =
  "[@media(hover:hover)_and_(min-width:48rem)]:opacity-0 " +
  "[@media(hover:hover)_and_(min-width:48rem)]:group-hover:opacity-100 " +
  "[@media(hover:hover)_and_(min-width:48rem)]:focus-within:opacity-100";

/** An open menu's cell rises above the rows after it (they paint later). */
const OPEN_MENU_ON_TOP = "has-[details[open]]:z-30";

/** The client-safe row shape the loader ships (a subset of the dashboard item). */
export interface ReportRowItem {
  readonly slug: string;
  readonly title: string;
  readonly isPublished: boolean;
  /** The real folder id — the delete form binds to it (may be an invisible folder). */
  readonly folderId: string;
  /** The id the Move <select> preselects (resolves an invisible folder to Root). */
  readonly displayFolderId: string;
  /** ADR-0080 — why edit won't work, or null. Rendered, never re-decided. */
  readonly editabilityNotice: { readonly label: string; readonly title: string } | null;
  /** ADR-0090 — what a SAVE would cost, or null. The orthogonal verdict: this
   *  one fires on a report the editor opens perfectly well. Its own slot, not
   *  a variant of the one above, because `editable` + `lossy` is a real state
   *  and one badge could not carry both sentences. Rendered, never re-decided. */
  readonly fidelityNotice: { readonly label: string; readonly title: string } | null;
  readonly sharing: ComponentProps<typeof ReportSharingMenu>["node"];
}

export function ReportRow({
  report: r,
  folders,
  folderLabel,
  sharingChoices,
  pendingSharing,
}: {
  report: ReportRowItem;
  folders: readonly { readonly id: string; readonly name: string }[];
  /** The resolved name of r.displayFolderId (parent resolves it once). */
  folderLabel: string;
  sharingChoices: ComponentProps<typeof ReportSharingMenu>["choices"];
  pendingSharing: ComponentProps<typeof ReportSharingMenu>["pendingState"];
}) {
  return (
    <li className="group relative grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-x-2 gap-y-2 border-b border-border px-3 py-3 transition-colors last:border-0 hover:bg-hover md:grid-cols-[minmax(0,1fr)_7rem_auto_2.5rem] md:gap-3 md:py-2.5">
      {/* Stretched-link open overlay (CSP-safe, ADR-0056 owner-open). z-0 paints
          above plain in-flow cells so clicking the name / status opens the
          report; interactive cells lift to z-10. A PROCESSING report (not yet
          published) is not openable — no overlay, so the row is inert until its
          clean version is live (#334; StatusBadge shows the pulsing state). */}
      {r.isPublished ? (
        <a
          href={`/reports/${r.slug}/open`}
          className="absolute inset-0 z-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
        >
          <span className="sr-only">Open {r.title}</span>
        </a>
      ) : null}

      {/* Name: title + slug + folder tag + (ADR-0080) editability note */}
      <div className="col-span-full min-w-0 md:col-span-1">
        <p title={r.title} className="text-sm font-medium break-words text-fg md:truncate">
          {r.title}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-subtle">
          <code className="font-mono">{r.slug}</code>
          <span title={folderLabel} className="inline-flex max-w-full min-w-0 items-center gap-1">
            <FolderIcon className="size-3.5 shrink-0" />
            <span className="truncate">{folderLabel}</span>
          </span>
          {r.editabilityNotice ? (
            <Badge tone="neutral" className="relative z-10" title={r.editabilityNotice.title}>
              {r.editabilityNotice.label}
            </Badge>
          ) : null}
          {/* ADR-0090 — the second verdict, in its own slot beside the first.
              Both can be absent, either can be present; in practice they are
              mutually exclusive (fidelity is only probed when editability is
              `editable`), but nothing here depends on that, so a future
              schema change cannot make the row drop a sentence. */}
          {r.fidelityNotice ? (
            <Badge tone="neutral" className="relative z-10" title={r.fidelityNotice.title}>
              {r.fidelityNotice.label}
            </Badge>
          ) : null}
        </div>
      </div>

      {/* Status */}
      <div>
        <StatusBadge isPublished={r.isPublished} />
      </div>

      {/* Sharing (ADR-0078 §12) — its own kebab, lifted above the overlay. Not
          positioned below `md`, so its menu anchors to the row's full width. */}
      <div className={cx("justify-self-start md:relative md:z-10", OPEN_MENU_ON_TOP)}>
        <ReportSharingMenu
          node={r.sharing}
          choices={sharingChoices}
          pendingState={pendingSharing}
        />
      </div>

      {/* Row actions — hover-revealed (also on keyboard focus / while open), a
          native <details> menu (no JS, CSP-safe). The full menu/keyboard model
          is #347; this just adds the reveal + keeps the existing actions.

          #363 adds Edit here as its own control. The row used to have ONE
          destination and it was the editor, which is why an owner clicked Edit
          when they wanted to LOOK at their report — the regression ADR-0089
          exists to fix. Now the stretched overlay above means Open (the owner
          view: chrome around the byte-for-byte report) and editing is this
          explicit, separate act.

          It is a link to `/reports/{slug}/open?to=edit`, NOT straight to the
          view origin: the editor needs an `Edit token`, and `/open` is the one
          place that mints one (ADR-0059 §4) after re-checking `canWrite` live.
          `z-10` lifts it above the `absolute inset-0` overlay — without that
          the overlay swallows the click and Edit silently means Open. */}
      <div
        className={cx(
          "relative z-10 flex items-center gap-1 justify-self-end transition-opacity",
          HOVER_REVEAL,
          OPEN_MENU_ON_TOP,
        )}
      >
        {r.isPublished ? (
          <a
            href={`/reports/${r.slug}/open?to=edit`}
            className="inline-flex h-11 min-w-11 items-center justify-center rounded-control px-3 text-xs font-medium text-subtle transition-colors hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring md:h-auto md:min-w-0 md:px-2 md:py-1"
          >
            Edit
            <span className="sr-only"> {r.title}</span>
          </a>
        ) : null}
        <details className="shrink-0">
          <summary className="flex size-11 cursor-pointer list-none items-center justify-center rounded-control text-subtle transition-colors hover:bg-hover hover:text-fg md:size-8 [&::-webkit-details-marker]:hidden">
            <MoreIcon className="size-4" />
            <span className="sr-only">Actions for {r.title}</span>
          </summary>
          <div className="absolute right-0 z-10 mt-1 w-60 max-w-[calc(100vw-2rem)] rounded-card border border-border bg-surface p-2 shadow-md">
            <RenameReportForm slug={r.slug} title={r.title} />
            <Form method="post" className="flex items-center gap-1.5 p-1">
              <input type="hidden" name="intent" value="move" />
              <input type="hidden" name="slug" value={r.slug} />
              <Select
                name="toFolderId"
                defaultValue={r.displayFolderId}
                aria-label={`Move ${r.title} to folder`}
                size="sm"
                className="min-w-0 flex-1 text-xs"
              >
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
              <Button type="submit" size="sm">
                Move
              </Button>
            </Form>
            {/* Destructive: a deliberate confirm dialog (#336, report §02),
                not a one-click submit. Posts the SAME delete-report intent. */}
            <div className="p-1">
              <DeleteReportDialog slug={r.slug} title={r.title} folder={r.folderId} />
            </div>
          </div>
        </details>
      </div>
    </li>
  );
}
