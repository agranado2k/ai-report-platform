import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * The product's 2026 chrome strip (App Shell Mockups `Z0W60dI8hu` §06): a thin
 * bar carrying the brand mark, the document's title over a small product
 * label, an optional status/state pill, and a right-hand action group. The
 * document below it dominates — that is the whole design intent, so this stays
 * a strip and never grows a second row.
 *
 * Extracted from the editor's `TopBar` when the owner view (ADR-0089) needed
 * the same bar with different actions. Two bars that are *supposed* to look
 * identical must not be two pieces of markup that happen to: the whole point
 * of a shell is that a change to the strip reaches every surface wearing it.
 * Surface-specific content goes in `pill` and `children`; nothing about a
 * particular route belongs in here.
 */
export interface ChromeBarProps {
  /** The document's own title. Rendered as a text node — callers pass report
   *  titles through here, and report titles are author-controlled. */
  readonly docTitle: string;
  /** An optional state pill rendered after the title (save status, share
   *  state). Always occupies its slot when provided, so a live region inside
   *  it stays stable across renders. */
  readonly pill?: ReactNode;
  /** The right-hand action group. */
  readonly children?: ReactNode;
}

export function ChromeBar({ docTitle, pill, children }: ChromeBarProps) {
  return (
    // `print:hidden` — printing a report keeps the document, never the chrome.
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-6 py-3 print:hidden">
      <div className="flex min-w-0 items-center gap-3">
        {/* The brand mark — a rounded brand-fill square with the Centaur
            monogram. Decorative (the product name sits beside it as text), so
            aria-hidden; a plain letterform keeps it CSP-safe with no icon dep. */}
        <span
          aria-hidden="true"
          className="grid size-7 shrink-0 place-items-center rounded-control bg-brand text-sm font-bold text-on-brand"
        >
          C
        </span>
        <div className="flex min-w-0 flex-col leading-tight">
          <h1 className="truncate text-sm font-semibold text-fg">{docTitle}</h1>
          <span className="text-[10px] font-medium uppercase tracking-wide text-subtle">
            Centaur Spec
          </span>
        </div>
        {pill}
      </div>

      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </header>
  );
}

/** The pill shape the chrome bar's `pill` slot expects — a low-emphasis chip
 *  that only wears its fill when it actually carries a message. Exported so a
 *  surface can build its own pill (a live region, a link) without restating
 *  the classes and drifting from the bar it sits in. */
export function chromeBarPillClass(filled: boolean): string {
  return cx(
    "ml-1 inline-flex items-center text-xs text-subtle",
    filled && "rounded-full bg-hover px-2.5 py-1 text-muted",
  );
}
