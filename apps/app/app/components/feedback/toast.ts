// Pure model for mutation feedback (#336, report Z0W60dI8hu §08 "Feedback that
// closes the loop"). Server mutations on the dashboard redirect — so their
// outcome cannot ride in `useActionData` (a redirect discards it). Instead they
// append a `?flash=<code>` the toast region reads on arrival: it shows a
// bottom-right toast with one relevant action, then strips the param so a
// refresh doesn't re-toast. The code→toast mapping, the URL parse/strip, and
// the region reducer are kept pure here; the island (ToastRegion.tsx) only
// renders them. No DOM, no React.

/** The visible toast tones — a subset of arp-ui's <Toast> tones, duplicated as
 *  a bare union so this module stays free of the React component. */
export type ToastTone = "success" | "danger" | "info" | "neutral";

/** The closed set of mutation outcomes that raise a toast. A closed enum so a
 *  tampered `?flash=` value can never invent a toast — an unknown code is
 *  ignored (parseFlash returns null). */
export type FlashCode =
  | "folder-created"
  | "folder-renamed"
  | "folder-deleted"
  | "report-moved"
  | "report-deleted";

const FLASH_CODES: readonly FlashCode[] = [
  "folder-created",
  "folder-renamed",
  "folder-deleted",
  "report-moved",
  "report-deleted",
];

export interface Flash {
  readonly code: FlashCode;
  /** The folder the outcome points at, for a "View" action (or null). */
  readonly folder: string | null;
  /** A human subject (e.g. the deleted report's title), or null. */
  readonly title: string | null;
}

export interface ToastDescriptor {
  /** Stable key for React + the dismiss reducer. */
  readonly id: string;
  readonly tone: ToastTone;
  readonly title: string;
  readonly description?: string;
  /** The single action's label (report §08: one action per toast) — omitted
   *  when there is no safe action to offer. */
  readonly actionLabel?: string;
  /** Where the action navigates. Paired with actionLabel. */
  readonly actionHref?: string;
}

function isFlashCode(value: string): value is FlashCode {
  return (FLASH_CODES as readonly string[]).includes(value);
}

/** Read a flash from a URL search string (`location.search`, may be "" or start
 *  with "?"). Returns null when there is no flash or the code is not one we
 *  know — a tampered code degrades to no toast rather than an error. */
export function parseFlash(search: string): Flash | null {
  const params = new URLSearchParams(search);
  const code = params.get("flash");
  if (!code || !isFlashCode(code)) return null;
  return {
    code,
    folder: params.get("folder"),
    title: params.get("title"),
  };
}

/** The search string with the flash-owned params removed (so `history` can be
 *  cleaned after the toast fires). Preserves everything else — the folder
 *  filter, the active query — in its original order. */
export function stripFlashParams(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("flash");
  params.delete("title");
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

let seq = 0;
/** A process-unique toast id (monotonic; the region only needs uniqueness). */
function nextId(): string {
  seq += 1;
  return `toast-${seq}`;
}

/** Map a parsed flash to the toast to show. Actions are only offered when they
 *  can actually be honoured: a created/moved outcome links to the folder it
 *  landed in; a delete offers NO Undo, because no restore use case exists yet —
 *  a button that does nothing is worse than none. */
export function toastForFlash(flash: Flash): ToastDescriptor {
  const viewFolder = flash.folder
    ? { actionLabel: "View", actionHref: `/?folder=${flash.folder}` }
    : {};
  switch (flash.code) {
    case "folder-created":
      return { id: nextId(), tone: "success", title: "Folder created", ...viewFolder };
    case "folder-renamed":
      return { id: nextId(), tone: "success", title: "Folder renamed", ...viewFolder };
    case "folder-deleted":
      return { id: nextId(), tone: "neutral", title: "Folder deleted" };
    case "report-moved":
      return { id: nextId(), tone: "success", title: "Report moved", ...viewFolder };
    case "report-deleted":
      return {
        id: nextId(),
        tone: "neutral",
        title: "Report deleted",
        description: flash.title ?? undefined,
      };
  }
}

/** The DOM CustomEvent the region listens on for client-raised toasts (a
 *  palette action, an inline rename outcome) — a decoupled channel so any island
 *  can raise a toast without threading React context through the shell. */
export const TOAST_EVENT = "centaur:toast";

/** Build a client-raised toast descriptor. `tone` defaults to success — the
 *  common case is a confirmation; a caller passes `danger` for a failure. */
export function makeToast(input: {
  readonly title: string;
  readonly description?: string;
  readonly tone?: ToastTone;
  readonly actionLabel?: string;
  readonly actionHref?: string;
}): ToastDescriptor {
  return {
    id: nextId(),
    tone: input.tone ?? "success",
    title: input.title,
    description: input.description,
    actionLabel: input.actionLabel,
    actionHref: input.actionHref,
  };
}

/** How many toasts stack at once (report §08: max 3 visible). */
export const MAX_VISIBLE_TOASTS = 3;

/** Append a toast, keeping at most the visible cap — the oldest fall off the
 *  top so a burst of mutations never buries the screen. */
export function pushToast(
  list: readonly ToastDescriptor[],
  toast: ToastDescriptor,
): ToastDescriptor[] {
  return [...list, toast].slice(-MAX_VISIBLE_TOASTS);
}

/** Remove one toast by id (a manual dismiss or the auto-dismiss timer). */
export function dismissToast(list: readonly ToastDescriptor[], id: string): ToastDescriptor[] {
  return list.filter((t) => t.id !== id);
}
