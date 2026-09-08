import { Form } from "@remix-run/react";
import { Button, cx, DialogFooter, DialogTitle } from "arp-ui";
import { useRef } from "react";

// The delete-report confirm dialog (#336, report Z0W60dI8hu §02): a destructive
// action gets a deliberate confirm step rather than a one-click button in the
// row menu. Native <dialog> (480px card, modal backdrop + Esc for free) — a ref
// is needed for showModal(), so the container class mirrors arp-ui's <Dialog>.
//
// The form posts the SAME `delete-report` intent the dashboard action already
// handles — chrome, not new mutation logic. `title` rides along so the success
// redirect's flash toast can name what was deleted. No Undo is offered because
// no restore use case exists yet (see toast.ts).

const DIALOG_CLASS =
  "m-auto w-[480px] max-w-[calc(100vw-2rem)] rounded-card border border-border bg-surface p-6 text-fg shadow-lg backdrop:bg-[rgb(20_24_40/0.45)]";

export function DeleteReportDialog({
  slug,
  title,
  folder,
}: {
  slug: string;
  title: string;
  /** The report's real folder id — the redirect returns to that folder's view. */
  folder: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="danger"
        onClick={() => dialogRef.current?.showModal()}
        className="w-full justify-start"
      >
        Delete report
      </Button>
      <dialog ref={dialogRef} aria-labelledby="delete-report-title" className={cx(DIALOG_CLASS)}>
        <DialogTitle id="delete-report-title">Delete report?</DialogTitle>
        <p className="mt-3 text-sm text-muted">
          <span className="font-medium text-fg">{title}</span> and its published version will be
          removed. This can’t be undone.
        </p>
        <Form method="post" className="mt-5">
          <input type="hidden" name="intent" value="delete-report" />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="folder" value={folder} />
          <input type="hidden" name="title" value={title} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => dialogRef.current?.close()}>
              Cancel
            </Button>
            <Button type="submit" variant="danger">
              Delete report
            </Button>
          </DialogFooter>
        </Form>
      </dialog>
    </>
  );
}
