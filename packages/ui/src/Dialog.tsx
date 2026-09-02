import type { ComponentProps } from "react";
import { cx } from "./cx";

// A modal dialog built on the native <dialog> element (report §07): 480px,
// card radius, an overlay via ::backdrop, focus containment and Esc-to-close
// come free from the platform. Opening is the consumer's job
// (`ref.showModal()`), which keeps this a pure, smoke-testable surface with no
// portal/runtime primitive (ADR-0050). `DialogTitle`/`DialogFooter` compose
// the header line and the right-aligned action row.
export function Dialog({ className, ...props }: ComponentProps<"dialog">) {
  return (
    <dialog
      className={cx(
        "m-auto w-[480px] max-w-[calc(100vw-2rem)] rounded-card border border-border bg-surface p-6 text-fg shadow-lg " +
          "backdrop:bg-[rgb(20_24_40/0.45)]",
        className,
      )}
      {...props}
    />
  );
}

export function DialogTitle({ className, children, ...props }: ComponentProps<"h2">) {
  return (
    <h2 className={cx("text-[17px] font-semibold", className)} {...props}>
      {children}
    </h2>
  );
}

export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("flex justify-end gap-2", className)} {...props} />;
}
