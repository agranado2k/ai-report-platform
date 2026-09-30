import { cx } from "arp-ui";
import type { ComponentProps } from "react";

/** Centered page container with consistent gutters. */
export function PageShell({ className, ...props }: ComponentProps<"main">) {
  return (
    <main
      className={cx("mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-10", className)}
      {...props}
    />
  );
}
