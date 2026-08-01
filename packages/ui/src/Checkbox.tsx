import type { ComponentProps } from "react";
import { cx } from "./cx";

// Native checkbox, theme-tinted via `accent-color` (accent-brand) rather than
// a re-drawn appearance-none control — the UA keeps rendering the box and the
// check mark (incl. dark `color-scheme` handling, theme.css), we only tint it
// and add the same focus ring the other field primitives use (Input.tsx).
// `type` is pinned; everything else passes through like Input/Select.
export function Checkbox({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  return (
    <input
      type="checkbox"
      className={cx(
        "size-4 shrink-0 cursor-pointer accent-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
