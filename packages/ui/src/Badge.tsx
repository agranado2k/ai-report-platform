import type { ComponentProps } from "react";
import { cx } from "./cx";

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "brand";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-surface-raised text-subtle",
  success: "bg-success/12 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/12 text-danger",
  brand: "bg-brand/10 text-brand",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: ComponentProps<"span"> & { tone?: BadgeTone }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
