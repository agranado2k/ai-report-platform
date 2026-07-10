import type { ComponentProps } from "react";
import { cx } from "./cx";

const field =
  "rounded-control border border-border bg-surface px-3 text-sm text-fg placeholder:text-subtle focus-visible:outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/30 disabled:opacity-50";

// Height as a prop (not a className the caller fights) — `cx` has no tailwind-merge,
// so a baked-in height would otherwise win the cascade over a caller's h-7.
export type FieldSize = "sm" | "md";
const heights: Record<FieldSize, string> = { sm: "h-7", md: "h-9" };

// Native `size` (a number) is unused here; drop it so the UI `size` can't clash.
export function Input({
  size = "md",
  className,
  ...props
}: Omit<ComponentProps<"input">, "size"> & { size?: FieldSize }) {
  return <input className={cx(field, heights[size], className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx(field, "py-2 leading-relaxed", className)} {...props} />;
}

export function Select({
  size = "md",
  className,
  ...props
}: Omit<ComponentProps<"select">, "size"> & { size?: FieldSize }) {
  return <select className={cx(field, heights[size], className)} {...props} />;
}
