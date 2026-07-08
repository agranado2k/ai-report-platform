// Pure success/failure decision for NewCommentComposer's fetcher-driven
// lifecycle (PR #157 review, Fix 2). Clearing `pendingSelection` unmounts the
// composer (CommentSidebar only renders it while a selection is pending), so
// that clear must wait for a DEFINITIVE success — never fire on submission
// alone. Firing early meant a 422/403 (e.g. a write grant revoked mid-session,
// a real ADR-0060 case) unmounted the composer before its <ActionError> could
// ever render, silently dropping both the error and the typed body.
//
// This is the one slice of that lifecycle pure enough to unit-test headless
// (no DOM, no mounted fetcher, no ProseMirror) — same carve-out rationale as
// `apps/app/app/editor`'s pure PM logic (see vitest.config.ts). The mounted
// composer itself (does it actually stay mounted through a failed submit,
// does the typed body survive) stays e2e territory like the rest of this
// app's routes/components.
export type CommentActionResult = { readonly ok: true } | { readonly error: string };

/** Mirrors Remix's `Fetcher["state"]` without importing `@remix-run/react`
 *  here — keeps this module a plain, dependency-free pure function. */
export type FetcherState = "idle" | "submitting" | "loading";

/** True only once the fetcher has settled back to `idle` carrying a
 *  successful result. False while in flight (`submitting`/`loading`), false
 *  with no result yet, and false on an error result — an error must stay
 *  visible via `<ActionError>`, not clear the composer out from under it. */
export function isCommentSubmitSuccess(
  state: FetcherState,
  data: CommentActionResult | undefined,
): boolean {
  return state === "idle" && data !== undefined && "ok" in data;
}
