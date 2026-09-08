// Pure UI-state helpers for the Comments panel's open/resolved filter (T8,
// viewer-chrome — report Z0W60dI8hu §06). apps/view has NO jsdom/component test
// tier (vitest `environment: "node"`; see the root vitest.config.ts glob
// `apps/view/app/edit/**/*.test.ts`), so the filter's DECISION logic is
// extracted here and unit-tested directly — the interactive toggling itself is
// proven in the browser tier (ADR-0079). No React/DOM/arp-domain-VALUE imports
// (a value import from the arp-domain barrel drags `node:crypto` into the
// browser bundle and breaks the Vite/Rollup build).
import type { CommentWire } from "./wire-types";

/** The panel's thread filter: Open (unresolved) or Resolved. Presentation-only
 *  (T8 is chrome, not model) — it changes what the reader SEES, never the
 *  comment data. Open is the default: an editor lands on the work still to do. */
export type ThreadFilter = "open" | "resolved";

/** Whether a thread is resolved — `resolved_at` carries a timestamp. Pure. */
export function isResolved(c: Pick<CommentWire, "resolved_at">): boolean {
  return c.resolved_at !== null;
}

/** Counts of ROOT threads by status, for the filter's Open/Resolved chips.
 *  Replies never count (they share their parent thread), matching
 *  `unresolvedCount` in panel.ts. Pure. */
export function countRootsByStatus(
  comments: readonly Pick<CommentWire, "parent_id" | "resolved_at">[],
): { readonly open: number; readonly resolved: number } {
  let open = 0;
  let resolved = 0;
  for (const c of comments) {
    if (c.parent_id !== null) continue;
    if (c.resolved_at !== null) resolved += 1;
    else open += 1;
  }
  return { open, resolved };
}

/** Whether a root thread is shown under `filter`. A FOCUSED thread — the one
 *  the user just clicked from its document highlight (item B: click-highlight →
 *  focus-panel) — is ALWAYS shown, so the filter can never hide the thread the
 *  reader just navigated to (that would silently swallow the click). Pure. */
export function threadVisibleUnderFilter(
  root: Pick<CommentWire, "id" | "resolved_at">,
  filter: ThreadFilter,
  focusedId: string | null,
): boolean {
  if (focusedId !== null && root.id === focusedId) return true;
  return filter === "resolved" ? isResolved(root) : !isResolved(root);
}
