import { type ComponentProps, forwardRef } from "react";
import { cx } from "./cx";

/**
 * A fixed-position floating surface — the primitive under selection-anchored
 * UI (the Selection toolbar, ticket #296). Positioning is the CALLER's job
 * (numbers usually come from arp-editor's pure `placeToolbar`); this only
 * owns the raised-surface look (ADR-0058 tokens) and the fixed anchoring.
 * Forwards its ref so callers can measure the rendered size before placing.
 */
export const Floating = forwardRef<
  HTMLDivElement,
  ComponentProps<"div"> & { readonly left: number; readonly top: number }
>(function Floating({ left, top, className, style, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cx("rounded-control border border-border bg-surface-raised shadow-lg", className)}
      // Positioning is INLINE STYLE, not a Tailwind class, deliberately: the
      // browser-test harness (tests/browser/) mounts real components with no
      // Tailwind stylesheet, and a class-based `fixed` would silently leave
      // the element in-flow there — the tier would measure a layout users
      // never see. Cosmetic classes may degrade unstyled; position must not.
      style={{ position: "fixed", left, top, zIndex: 50, ...style }}
      {...props}
    />
  );
});
