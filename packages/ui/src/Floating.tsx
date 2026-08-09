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
      // Caller `style` spreads FIRST so it can never defeat the positioning
      // (smoke-tested). NB for the view-origin CSP work: this is inline
      // style on the /edit surface — a future `style-src` tightening that
      // drops 'unsafe-inline' (the report-only shadow policy in
      // arp-headers/view stages one) would silently un-position every
      // Floating; migrate to CSS variables if that lands.
      style={{ ...style, position: "fixed", left, top, zIndex: 50 }}
      {...props}
    />
  );
});
