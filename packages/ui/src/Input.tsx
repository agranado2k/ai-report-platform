import type { ComponentProps } from "react";
import { cx } from "./cx";

// Rest / hover / focus / error states (report Z0W60dI8hu §07): 1px border, an
// xs shadow, the placeholder in --placeholder, and the same 3px brand focus
// ring the whole system uses. `error` swaps the border+ring to danger and
// wires aria-invalid, so a form field reads as wrong without relying on colour
// alone (the caller still supplies the error text via FieldError-style copy).
const field =
  "w-full rounded-control border bg-surface px-3 text-sm text-fg shadow-xs " +
  "placeholder:text-placeholder transition-[border-color,box-shadow] ease-standard duration-150 " +
  "focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-bg";
const rest =
  "border-border hover:border-border-strong focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand-ring";
const errored =
  "border-danger focus-visible:border-danger focus-visible:ring-[3px] focus-visible:ring-danger/30";

// Height as a prop (not a caller className) — `cx` has no tailwind-merge, so a
// baked-in height would otherwise win the cascade over a caller's h-8.
export type FieldSize = "sm" | "md";
const heights: Record<FieldSize, string> = { sm: "h-8", md: "h-9" };

// Native `size` (a number) is unused here; drop it so the UI `size` can't clash.
export function Input({
  size = "md",
  error = false,
  className,
  ...props
}: Omit<ComponentProps<"input">, "size"> & { size?: FieldSize; error?: boolean }) {
  return (
    <input
      className={cx(field, heights[size], error ? errored : rest, className)}
      aria-invalid={error || undefined}
      {...props}
    />
  );
}

export function Textarea({
  error = false,
  className,
  ...props
}: ComponentProps<"textarea"> & { error?: boolean }) {
  return (
    <textarea
      className={cx(field, "py-2 leading-relaxed", error ? errored : rest, className)}
      aria-invalid={error || undefined}
      {...props}
    />
  );
}

export function Select({
  size = "md",
  error = false,
  className,
  ...props
}: Omit<ComponentProps<"select">, "size"> & { size?: FieldSize; error?: boolean }) {
  return (
    <select
      className={cx(field, heights[size], error ? errored : rest, className)}
      aria-invalid={error || undefined}
      {...props}
    />
  );
}
