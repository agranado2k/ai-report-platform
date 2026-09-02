import type { ComponentProps } from "react";
import { cx } from "./cx";

// A side sheet surface (report §07): a 384px panel joined to the right edge.
// Like Dialog, this owns the LOOK only; the overlay and open/close are the
// consumer's (the viewer's comments panel, a future filter sheet). Rendered as
// an <aside> so it reads as complementary content to assistive tech.
export type SheetSide = "right" | "left";
const sides: Record<SheetSide, string> = {
  right: "border-l",
  left: "border-r",
};

export function Sheet({
  side = "right",
  className,
  ...props
}: ComponentProps<"aside"> & { side?: SheetSide }) {
  return (
    <aside
      className={cx(
        "flex h-full w-96 max-w-[calc(100vw-3rem)] flex-col border-border bg-surface",
        sides[side],
        className,
      )}
      {...props}
    />
  );
}
