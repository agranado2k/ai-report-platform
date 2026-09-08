import { describe, expect, it } from "vitest";
import {
  dismissToast,
  MAX_VISIBLE_TOASTS,
  makeToast,
  parseFlash,
  pushToast,
  stripFlashParams,
  TOAST_EVENT,
  type ToastDescriptor,
  toastForFlash,
} from "./toast";

// Pure model for mutation feedback (#336, report Z0W60dI8hu §08 "Feedback that
// closes the loop"). Server mutations redirect with a `?flash=<code>`; the toast
// region reads it, shows a bottom-right toast with one action, then strips the
// param. The code→toast mapping, the URL parse/strip, and the region reducer
// (cap 3) are all pure decisions the island only renders.

describe("parseFlash", () => {
  it("reads a known flash code and the folder it points at", () => {
    expect(parseFlash("?flash=folder-created&folder=q3")).toEqual({
      code: "folder-created",
      folder: "q3",
      title: null,
    });
  });
  it("reads an optional human title (for the deleted subject)", () => {
    expect(parseFlash("?flash=report-deleted&title=Q3%20hiring%20plan")).toEqual({
      code: "report-deleted",
      folder: null,
      title: "Q3 hiring plan",
    });
  });
  it("returns null when there is no flash, or the code is unknown", () => {
    expect(parseFlash("?folder=q3")).toBeNull();
    expect(parseFlash("")).toBeNull();
    expect(parseFlash("?flash=please-run-rm-rf")).toBeNull();
  });
});

describe("stripFlashParams", () => {
  it("removes only the flash-owned params, preserving the rest", () => {
    expect(stripFlashParams("?flash=folder-created&folder=q3")).toBe("?folder=q3");
    expect(stripFlashParams("?flash=report-deleted&title=x&q=road")).toBe("?q=road");
  });
  it("returns an empty string when nothing is left", () => {
    expect(stripFlashParams("?flash=folder-deleted")).toBe("");
  });
});

describe("toastForFlash", () => {
  it("maps folder-created to a success toast with a View action at the folder", () => {
    const t = toastForFlash({ code: "folder-created", folder: "q3", title: null });
    expect(t).toMatchObject({ tone: "success", title: "Folder created", actionLabel: "View" });
    expect(t.actionHref).toBe("/?folder=q3");
  });
  it("maps report-moved to a success toast that opens the destination folder", () => {
    const t = toastForFlash({ code: "report-moved", folder: "q3", title: null });
    expect(t).toMatchObject({ tone: "success", title: "Report moved", actionLabel: "View" });
    expect(t.actionHref).toBe("/?folder=q3");
  });
  it("names the deleted report and offers no fabricated Undo (no restore seam)", () => {
    const t = toastForFlash({ code: "report-deleted", folder: null, title: "Q3 hiring plan" });
    expect(t.tone).toBe("neutral");
    expect(t.title).toBe("Report deleted");
    expect(t.description).toBe("Q3 hiring plan");
    // No restore use case exists yet, so the toast must not promise an Undo it
    // cannot honour — better silent than a dead button.
    expect(t.actionLabel).toBeUndefined();
    expect(t.actionHref).toBeUndefined();
  });
  it("gives every descriptor a unique id so the region can key + dismiss it", () => {
    const a = toastForFlash({ code: "folder-created", folder: "q3", title: null });
    const b = toastForFlash({ code: "folder-created", folder: "q3", title: null });
    expect(a.id).not.toBe(b.id);
  });
});

describe("makeToast (client-raised toasts)", () => {
  it("builds a descriptor with a unique id and a default success tone", () => {
    const t = makeToast({ title: "Endpoint copied" });
    expect(t).toMatchObject({ tone: "success", title: "Endpoint copied" });
    expect(t.id).toMatch(/^toast-/);
    expect(makeToast({ title: "x" }).id).not.toBe(t.id);
  });
  it("carries a chosen tone and description through", () => {
    expect(
      makeToast({ title: "Rename failed", description: "Name taken", tone: "danger" }),
    ).toMatchObject({ tone: "danger", title: "Rename failed", description: "Name taken" });
  });
  it("names the DOM event the region listens on", () => {
    expect(TOAST_EVENT).toBe("centaur:toast");
  });
});

describe("region reducer", () => {
  const make = (id: string): ToastDescriptor => ({ id, tone: "success", title: id });

  it("appends toasts, keeping at most the visible cap (oldest drop off)", () => {
    let list: ToastDescriptor[] = [];
    for (const id of ["a", "b", "c", "d"]) list = pushToast(list, make(id));
    expect(list.map((t) => t.id)).toEqual(["b", "c", "d"]);
    expect(list.length).toBe(MAX_VISIBLE_TOASTS);
  });
  it("dismisses a toast by id, leaving the rest", () => {
    const list = [make("a"), make("b"), make("c")];
    expect(dismissToast(list, "b").map((t) => t.id)).toEqual(["a", "c"]);
  });
});
