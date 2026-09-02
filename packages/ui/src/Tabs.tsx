import type { ComponentProps } from "react";
import { cx } from "./cx";

// A horizontal tab bar (Settings sections, the viewer's Comments/Versions
// panel — report §04/§06). `Tabs` is the tablist row; `Tab` is one tab, active
// when `active` is set (an underline + weight, no colour-only signal). A Tab
// renders as a <button> by default; pass `as="a"` for a link tab (routing).
export function Tabs({ className, ...props }: ComponentProps<"div">) {
  return (
    <div role="tablist" className={cx("flex gap-1 border-b border-border", className)} {...props} />
  );
}

const tab =
  "inline-flex h-10 items-center gap-1.5 border-b-2 px-3 -mb-px text-sm " +
  "transition-colors ease-standard duration-150 focus-visible:outline-none " +
  "focus-visible:ring-[3px] focus-visible:ring-brand-ring rounded-t-[6px]";
const tabActive = "border-brand text-fg font-medium";
const tabIdle = "border-transparent text-muted hover:text-fg";

export function Tab({
  active = false,
  className,
  ...props
}: ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={cx(tab, active ? tabActive : tabIdle, className)}
      {...props}
    />
  );
}
