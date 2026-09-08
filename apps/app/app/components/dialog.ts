// Shared native-<dialog> helper (#336). `showModal()` throws a DOMException
// (InvalidStateError) when the dialog is ALREADY open, so every caller must
// check first. Two islands hit that case: the ⌘K palette (pressing ⌘K while the
// palette is open) and the new-folder dialog (its error path re-opens a dialog a
// failed <Form> submit left open — a submit does not close a native dialog).
// This is the one guard both use.

/** Open a native <dialog> as a modal, but only when it is closed — a no-op for a
 *  null/undefined ref or an already-open dialog, so a repeated open never throws. */
export function openModal(dialog: HTMLDialogElement | null | undefined): void {
  if (dialog && !dialog.open) dialog.showModal();
}
