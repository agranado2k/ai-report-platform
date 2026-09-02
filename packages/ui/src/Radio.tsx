import type { ComponentProps } from "react";
import { cx } from "./cx";

// Native radio, theme-tinted via `accent-color` (accent-brand) — same approach
// as Checkbox: the UA keeps drawing the control (and its dot, incl. light
// `color-scheme`), we only tint it and add the shared 3px brand focus ring.
// A radio is visually distinct from the checkbox (round vs rounded-square) and
// from the switch (a track+thumb) — the three must never read the same
// (report Z0W60dI8hu §07). `type` is pinned; everything else passes through.
export function Radio({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  return (
    <input
      type="radio"
      className={cx(
        "size-4 shrink-0 cursor-pointer accent-brand focus-visible:outline-none " +
          "focus-visible:ring-[3px] focus-visible:ring-brand-ring " +
          "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
