import { Form } from "@remix-run/react";
import { Button, cx, DialogFooter, DialogTitle, Input } from "arp-ui";
import { useCallback, useEffect, useRef } from "react";

// The "New folder" dialog (#336, report Z0W60dI8hu §02): creating a folder gets
// a deliberate dialog step rather than an always-present inline field. Built on
// the native <dialog> (480px card, modal backdrop + Esc for free) — a ref is
// needed for showModal(), so the container class mirrors arp-ui's <Dialog>
// rather than composing it (that component doesn't forward a ref).
//
// The form posts the SAME `new-folder` intent the dashboard action already
// handles (and the e2e suite drives directly) — this is chrome, not new mutation
// logic. Two entry points open it: its own trigger button, and the ⌘K palette's
// "New folder" action, over the OPEN_NEW_FOLDER_EVENT. A failed create returns
// its error to the route, which passes it back here and the dialog re-opens so
// the rejected name can be fixed and retried.

export const OPEN_NEW_FOLDER_EVENT = "centaur:open-new-folder";

const DIALOG_CLASS =
  "m-auto w-[480px] max-w-[calc(100vw-2rem)] rounded-card border border-border bg-surface p-6 text-fg shadow-lg backdrop:bg-[rgb(20_24_40/0.45)]";

export function NewFolderDialog({
  parentId,
  parentLabel,
  error,
  className,
}: {
  /** The wire folder id the new folder nests under (the selected folder or Root). */
  parentId: string;
  /** The human name of the parent, for the field placeholder + title. */
  parentLabel: string;
  /** A create failure echoed back by the route, or null. Re-opens the dialog. */
  error?: string | null;
  className?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const openDialog = useCallback(() => dialogRef.current?.showModal(), []);

  // Palette entry point: the "New folder" action dispatches this event.
  useEffect(() => {
    const onOpen = () => openDialog();
    window.addEventListener(OPEN_NEW_FOLDER_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_NEW_FOLDER_EVENT, onOpen);
  }, [openDialog]);

  // A rejected create re-opens the dialog with the error visible, so the name
  // that failed is right there to fix rather than lost behind a closed dialog.
  useEffect(() => {
    if (error) openDialog();
  }, [error, openDialog]);

  return (
    <>
      <Button type="button" variant="secondary" onClick={openDialog} className={className}>
        + New folder
      </Button>
      <dialog ref={dialogRef} aria-labelledby="new-folder-title" className={cx(DIALOG_CLASS)}>
        <DialogTitle id="new-folder-title">New folder</DialogTitle>
        <Form method="post" className="mt-5 grid gap-5">
          <input type="hidden" name="intent" value="new-folder" />
          <input type="hidden" name="parentId" value={parentId} />
          <div className="grid gap-1.5">
            <label htmlFor="new-folder-name" className="text-[13.5px] font-medium text-fg">
              Name
            </label>
            <Input
              id="new-folder-name"
              name="name"
              placeholder={`New folder in ${parentLabel}`}
              required
              autoComplete="off"
              aria-invalid={error ? true : undefined}
            />
            {error ? (
              <p role="alert" className="text-[13px] text-danger-fg">
                {error}
              </p>
            ) : (
              <p className="text-[13px] text-muted">Creates a folder inside {parentLabel}.</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => dialogRef.current?.close()}>
              Cancel
            </Button>
            <Button type="submit">Create folder</Button>
          </DialogFooter>
        </Form>
      </dialog>
    </>
  );
}
