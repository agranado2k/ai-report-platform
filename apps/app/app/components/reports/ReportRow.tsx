import { Form } from "@remix-run/react";
import { Badge, Button, cx, FolderIcon, MoreIcon, Select } from "arp-ui";
import type { ComponentProps } from "react";
import { RenameReportForm } from "../RenameReportForm";
import { ReportSharingMenu } from "../ReportSharingMenu";
import { StatusBadge } from "../StatusBadge";

// One report row of the dashboard table (#335). Extracted from the route so it
// is prop-driven and node-render smoke-testable (a real <li>, so list semantics — the #346 regression from the <ul>→<div> grid — are restored) (the route itself has no unit
// seam), and so the ARIA table semantics + the hover-reveal live in one place.
// Behaviour is unchanged from T4a (#334) — the sharing kebab and the
// rename/move/delete <details> menu are the same controls; the interaction
// layer (keyboard model, multi-select/bulk, a unified menu) is #347.

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
    <li className="group relative grid grid-cols-[1fr_7rem_auto_2.5rem] items-center gap-3 border-b border-border px-3 py-2.5 transition-colors last:border-0 hover:bg-hover">
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
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-fg">{r.title}</p>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-subtle">
          <code className="font-mono">{r.slug}</code>
          <span className="inline-flex items-center gap-1">
            <FolderIcon className="size-3.5" />
            {folderLabel}
          </span>
          {r.editabilityNotice ? (
            <Badge tone="neutral" className="relative z-10" title={r.editabilityNotice.title}>
              {r.editabilityNotice.label}
            </Badge>
          ) : null}
        </div>
      </div>

      {/* Status */}
      <div>
        <StatusBadge isPublished={r.isPublished} />
      </div>

      {/* Sharing (ADR-0078 §12) — its own kebab, lifted above the overlay */}
      <div className="relative z-10 justify-self-start">
        <ReportSharingMenu
          node={r.sharing}
          choices={sharingChoices}
          pendingState={pendingSharing}
        />
      </div>

      {/* Row actions — hover-revealed (also on keyboard focus / while open), a
          native <details> menu (no JS, CSP-safe). The full menu/keyboard model
          is #347; this just adds the reveal + keeps the existing actions. */}
      <div
        className={cx(
          "relative z-10 justify-self-end opacity-0 transition-opacity",
          "group-hover:opacity-100 focus-within:opacity-100",
        )}
      >
        <details className="shrink-0">
          <summary className="flex size-8 cursor-pointer list-none items-center justify-center rounded-control text-subtle transition-colors hover:bg-hover hover:text-fg [&::-webkit-details-marker]:hidden">
            <MoreIcon className="size-4" />
            <span className="sr-only">Actions for {r.title}</span>
          </summary>
          <div className="absolute right-0 z-10 mt-1 w-60 rounded-card border border-border bg-surface p-2 shadow-md">
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
            <Form method="post" className="p-1">
              <input type="hidden" name="intent" value="delete-report" />
              <input type="hidden" name="slug" value={r.slug} />
              <input type="hidden" name="folder" value={r.folderId} />
              <Button type="submit" size="sm" variant="danger" className="w-full justify-start">
                Delete report
              </Button>
            </Form>
          </div>
        </details>
      </div>
    </li>
  );
}
