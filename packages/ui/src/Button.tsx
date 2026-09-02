import type { ComponentProps } from "react";
import { cx } from "./cx";

// Variants (ADR-0086 / report Z0W60dI8hu §07): one PRIMARY per view; SECONDARY
// is a tinted neutral fill (no border); OUTLINE is the only bordered one and
// the only one that carries the xs shadow; GHOST is hover-fill only; DANGER is
// a solid destructive; GRADIENT is the violet→pink CTA, reserved for one hero
// moment per view, never a row action.
export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "gradient";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-control font-medium whitespace-nowrap " +
  "transition-[background-color,border-color,box-shadow,color] ease-standard duration-150 " +
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-ring " +
  "disabled:opacity-50 disabled:pointer-events-none";

// 32 / 36 / 40px (report §09). Height is baked into the variant string rather
// than a caller className because `cx` has no tailwind-merge (see Input.tsx).
const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-9 px-3.5 text-sm",
  lg: "h-10 px-5 text-[15px]",
};
// Icon-only buttons are square — same heights, no horizontal padding.
const iconSizes: Record<ButtonSize, string> = { sm: "size-8", md: "size-9", lg: "size-10" };

const variants: Record<ButtonVariant, string> = {
  primary: "bg-brand text-on-brand shadow-xs hover:bg-brand-hover",
  secondary: "bg-hover text-fg hover:bg-border",
  outline:
    "bg-surface text-fg border border-border shadow-xs hover:bg-hover hover:border-border-strong",
  ghost: "text-muted hover:bg-hover hover:text-fg",
  danger: "bg-danger text-on-brand shadow-xs hover:brightness-95",
  gradient: "text-on-brand shadow-xs bg-[image:var(--gradient-brand)] hover:brightness-95",
};

/** Class string for the button look — use on a `<Link>`/`<a>` that should look
 *  like a button (the dashboard's upload link, TopBar, etc.). */
export function buttonClass(
  variant: ButtonVariant = "secondary",
  size: ButtonSize = "md",
  opts?: { iconOnly?: boolean },
): string {
  return cx(base, opts?.iconOnly ? iconSizes[size] : sizes[size], variants[variant]);
}

export function Button({
  variant = "secondary",
  size = "md",
  iconOnly = false,
  loading = false,
  className,
  type = "button",
  disabled,
  children,
  ...props
}: ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  /** Show a spinner and disable; the button keeps its width so the row can't reflow. */
  loading?: boolean;
}) {
  return (
    <button
      type={type}
      className={cx(buttonClass(variant, size, { iconOnly }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="size-3.5 animate-spin rounded-full border-2 border-transparent border-t-current motion-reduce:animate-none"
        />
      ) : null}
      {children}
    </button>
  );
}
