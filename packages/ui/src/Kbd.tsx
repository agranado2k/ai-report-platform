import type { ComponentProps } from "react";
import { cx } from "./cx";

// A keyboard-key cap — for shortcut hints in the command palette, menus, and
// tooltips (⌘K, ↵, esc). Renders a <kbd>; uses the SANS font, not mono, so it
// reads as a UI chip rather than code (report Z0W60dI8hu §07).
export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cx(
        "inline-flex h-5 min-w-5 items-center justify-center gap-0.5 rounded-[5px] " +
          "border border-border bg-surface px-1.5 font-sans text-[11px] font-medium text-muted",
        className,
      )}
      {...props}
    />
  );
}
