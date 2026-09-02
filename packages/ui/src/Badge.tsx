import type { ComponentProps } from "react";
import { cx } from "./cx";

// Tinted-fill + dark-text-tier tones (report Z0W60dI8hu §07). The base semantic
// hues (--success etc.) are FILLS and fail WCAG AA as text on the light ground,
// so a badge pairs the -soft fill with the -fg text tier (added in T1). An
// optional leading dot carries state without relying on colour alone.
export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-hover text-muted",
  success: "bg-success-soft text-success-fg",
  warning: "bg-warning-soft text-warning-fg",
  danger: "bg-danger-soft text-danger-fg",
  info: "bg-info-soft text-info-fg",
  brand: "bg-brand-soft text-brand-hover",
};

export function Badge({
  tone = "neutral",
  dot = false,
  className,
  children,
  ...props
}: ComponentProps<"span"> & {
  tone?: BadgeTone;
  /** Leading status dot (currentColor), e.g. Published / Processing / Failed. */
  dot?: boolean;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
      {...props}
    >
      {dot ? <span aria-hidden="true" className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}
