// Guard for opening a native <dialog> (#336). Calling showModal() on a dialog
// that is ALREADY open throws a DOMException (InvalidStateError) — the ⌘K
// palette (⌘K while open) and the new-folder dialog (its error path re-opens a
// dialog a failed <Form> submit left open) both hit that case. `openModal` is
// the shared guard: it opens only when the dialog is closed. jsdom does not
// implement showModal, so this pins the decision against a hand-rolled fake that
// models the one native rule we care about — a re-open on an open dialog throws.
import { describe, expect, it, vi } from "vitest";
import { openModal } from "./dialog";

/** A minimal stand-in for the native <dialog> open/showModal contract: showModal
 *  sets `open`, and calling it while already open throws like the real element. */
function fakeDialog() {
  const d = {
    open: false,
    showModal: vi.fn(() => {
      if (d.open) throw new DOMException("dialog already open", "InvalidStateError");
      d.open = true;
    }),
  };
  return d as { open: boolean; showModal: ReturnType<typeof vi.fn> };
}

describe("openModal", () => {
  it("opens a closed dialog", () => {
    const d = fakeDialog();
    openModal(d as unknown as HTMLDialogElement);
    expect(d.open).toBe(true);
    expect(d.showModal).toHaveBeenCalledTimes(1);
  });

  it("does not call showModal (or throw) when the dialog is already open", () => {
    const d = fakeDialog();
    openModal(d as unknown as HTMLDialogElement); // first open
    expect(() => openModal(d as unknown as HTMLDialogElement)).not.toThrow();
    // Guarded: the second open was a no-op, so showModal fired exactly once.
    expect(d.showModal).toHaveBeenCalledTimes(1);
    expect(d.open).toBe(true);
  });

  it("is a no-op for a null/undefined ref", () => {
    expect(() => openModal(null)).not.toThrow();
    expect(() => openModal(undefined)).not.toThrow();
  });
});
