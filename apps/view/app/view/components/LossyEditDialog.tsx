// The Edit confirm for a lossy ReportVersion (ADR-0090, ticket #364).
//
// The owner view is where an owner finally SEES their report as published
// (ADR-0089), so it is the one surface where "open this in the editor" and
// "here is what the editor would delete" can be put side by side. A deck with
// inline <script> and inline <svg> opens cleanly and would be republished
// without its interactivity; until now nothing said so.
//
// IT EXPLAINS AND PROCEEDS — never gates (ADR-0090 §5). "Edit anyway" is a
// real link to the editor, and Edit itself stays an ordinary anchor that the
// dialog merely INTERCEPTS: with JS unavailable the click just navigates,
// which is harmless because the editor writes nothing until Save. A <button>
// would have stranded that owner in exchange for a warning, and a verdict that
// could be stale must never lock anyone out of their own report.
//
// STYLING follows the app's existing 2026 dialogs (ADR-0086) — the same native
// <dialog> at 480px with the card radius, border, surface and backdrop that
// `DeleteReportDialog` and arp-ui's <Dialog> use. It repeats the class string
// rather than importing <Dialog> for the same reason `DeleteReportDialog`
// does: `showModal()` needs a ref, and arp-ui's <Dialog> is a plain function
// component that forwards none. `DialogTitle` / `DialogFooter` ARE imported,
// so the header line and the action row cannot drift.
import { Button, buttonClass, DialogFooter, DialogTitle } from "arp-ui";
import { useRef } from "react";
import type { LossyWarning } from "../lossy-warning";

const DIALOG_CLASS =
  "m-auto w-[480px] max-w-[calc(100vw-2rem)] rounded-card border border-border bg-surface p-6 text-fg shadow-lg backdrop:bg-[rgb(20_24_40/0.45)]";

/** Render a name list as prose: `script`, `svg` and `onclick`.
 *
 *  PRECONDITION: `names` is already deduplicated — `probeFidelity` collects
 *  element and attribute names as a deduplicated set (ADR-0090 §1), which is
 *  what makes `key={name}` safe here. This component does not re-dedupe, so a
 *  probe that ever started emitting repeats would collide these keys. */
function NameList({ names }: { names: readonly string[] }) {
  return (
    <>
      {names.map((name, i) => (
        <span key={name}>
          {i > 0 ? (i === names.length - 1 ? " and " : ", ") : ""}
          <code className="font-mono text-fg">{name}</code>
        </span>
      ))}
    </>
  );
}

export function LossyEditDialog({
  editHref,
  warning,
}: {
  readonly editHref: string;
  readonly warning: LossyWarning;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { lostElements, lostAttributes } = warning;
  // Both lists empty is a REAL state, not a bug: `loadLossyWarning` returns it
  // when the recorded verdict stands but the bytes could not be re-read. The
  // dialog still has to say something true, so it falls back to the general
  // consequence rather than rendering an empty list or — worse — implying
  // nothing would be lost.
  const clauses = [
    { noun: "elements", names: lostElements },
    { noun: "attributes", names: lostAttributes },
  ].filter((c) => c.names.length > 0);
  const named = clauses.length > 0;

  return (
    <>
      <a
        href={editHref}
        className={buttonClass("primary", "sm")}
        onClick={(e) => {
          const dialog = dialogRef.current;
          // Let the plain navigation happen if <dialog> is unavailable, and
          // never swallow a modified click — ctrl/cmd/middle-click opening the
          // editor in a new tab is exactly as safe as it was before.
          if (!dialog?.showModal || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          dialog.showModal();
        }}
      >
        Edit
      </a>
      {/* `aria-describedby` alongside `aria-labelledby`: the title announces
          THAT something would be dropped, and the paragraph below announces
          WHAT. Naming the consequence is this dialog's entire job, so a screen
          reader has to receive it when the dialog opens rather than having to
          go looking for it. */}
      <dialog
        ref={dialogRef}
        aria-labelledby="lossy-edit-title"
        aria-describedby="lossy-edit-desc"
        className={DIALOG_CLASS}
      >
        <DialogTitle id="lossy-edit-title">Editing would drop part of this report</DialogTitle>
        <p id="lossy-edit-desc" className="mt-3 text-sm text-muted">
          The editor can open this report, but it doesn’t keep everything in it.{" "}
          {named ? (
            <>
              Saving from the editor would remove{" "}
              {clauses.map((clause, i) => (
                <span key={clause.noun}>
                  {i > 0 ? ", and " : ""}
                  <NameList names={clause.names} /> {clause.noun}
                </span>
              ))}
              .
            </>
          ) : (
            <>
              Saving from the editor would remove content such as inline scripts, inline SVG, or
              attributes outside the editor’s schema.
            </>
          )}
        </p>
        <p className="mt-3 text-sm text-muted">
          Nothing changes until you save: the published version stays exactly as it is, and you can
          leave the editor without touching it. To change this report without losing anything,
          re-upload the full HTML instead.
        </p>
        <DialogFooter className="mt-5">
          <Button type="button" variant="outline" onClick={() => dialogRef.current?.close()}>
            Cancel
          </Button>
          <a href={editHref} className={buttonClass("primary", "md")}>
            Edit anyway
          </a>
        </DialogFooter>
      </dialog>
    </>
  );
}
