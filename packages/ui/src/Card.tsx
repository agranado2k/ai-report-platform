import type { ComponentProps } from "react";
import { cx } from "./cx";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cx("rounded-card border border-border bg-surface shadow-sm", className)}
      {...props}
    />
  );
}
