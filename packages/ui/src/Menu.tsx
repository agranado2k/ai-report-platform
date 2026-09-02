import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";

// A menu surface + items (the report-row kebab menu, the account menu — §07).
// This owns only the LOOK of the popover and its items; opening/closing and
// focus are the consumer's job (a native popover / details, wired by the
// dashboard slice). `Menu` is the raised panel; `MenuItem` is one row (a
// <button> by default, or a link when `href` is set); `MenuSeparator` is the
// divider. A `danger` item takes the danger text tier.
export function Menu({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      role="menu"
      className={cx(
        "grid min-w-52 gap-px rounded-card border border-border bg-surface p-1.5 shadow-md",
        className,
      )}
      {...props}
    />
  );
}

const item =
  "flex h-[34px] items-center gap-2.5 rounded-[6px] px-2.5 text-left text-[13px] text-fg " +
  "[&_svg]:size-4 [&_svg]:text-muted hover:bg-hover focus-visible:bg-hover focus-visible:outline-none " +
  "disabled:opacity-50 disabled:pointer-events-none";
const itemDanger =
  "text-danger-fg [&_svg]:text-danger-fg hover:bg-danger-soft focus-visible:bg-danger-soft";

export function MenuItem({
  danger = false,
  shortcut,
  className,
  children,
  ...props
}: ComponentProps<"button"> & { danger?: boolean; shortcut?: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cx(item, danger && itemDanger, className)}
      {...props}
    >
      {children}
      {shortcut ? <span className="ml-auto text-[11px] text-placeholder">{shortcut}</span> : null}
    </button>
  );
}

export function MenuSeparator({ className, ...props }: ComponentProps<"hr">) {
  return <hr className={cx("my-1 border-0 border-t border-border", className)} {...props} />;
}
