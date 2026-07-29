// Composer keyboard ergonomics + keystroke isolation (comment-UX adoptions,
// item C; the gap-analysis report's slide-deck lesson applied to today's
// surface). Pure, DOM-free (structural event shape) so it's unit-testable in
// this repo's node-only vitest tier — the panel's composers wire it onto
// their <Textarea onKeyDown>.
//
// THE ISOLATION RULE (the report's hard-won detail, verbatim requirement):
// keystrokes inside ANY comment composer must never reach document/editor-
// level keyboard handlers — so propagation stops on EVERY keydown. But
// `preventDefault` fires ONLY for the two action combos (⌘/Ctrl+Enter, Esc):
// the report documents the exact trap where a guard that preventDefaults
// space/arrow/character keys while the caret is in the textarea silently
// breaks typing. Plain Enter is a NEWLINE (action "none") — only the
// modifier combo submits.

export type ComposerKeyAction = "submit" | "cancel" | "none";

/** The minimal keyboard-event shape this module reads — structurally
 *  satisfied by both React's synthetic KeyboardEvent and a plain test fake. */
export interface ComposerKeyEvent {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
}

export interface StoppableComposerKeyEvent extends ComposerKeyEvent {
  stopPropagation(): void;
  preventDefault(): void;
}

export function composerKeyAction(e: ComposerKeyEvent): ComposerKeyAction {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) return "submit";
  if (e.key === "Escape") return "cancel";
  return "none";
}

export interface ComposerKeyHandlers {
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}

export function handleComposerKeyDown(
  e: StoppableComposerKeyEvent,
  handlers: ComposerKeyHandlers,
): void {
  // Isolation: every composer keystroke stops here — never the document's.
  e.stopPropagation();
  const action = composerKeyAction(e);
  if (action === "none") return; // and NO preventDefault — typing stays native.
  e.preventDefault();
  if (action === "submit") handlers.onSubmit();
  else handlers.onCancel();
}
