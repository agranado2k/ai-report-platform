import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";

// A single toast surface (report §07/§08): a raised card with a leading icon,
// a title + optional description, and one action (Undo / Open). Positioning
// and the visible-count / auto-dismiss policy (bottom-right, 3 max, 4s) belong
// to the consumer's toast region; this owns the individual toast's look only.
export function Toast({
  icon,
  title,
  action,
  className,
  children,
  ...props
}: Omit<ComponentProps<"div">, "title"> & {
  icon?: ReactNode;
  title?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role="status"
      className={cx(
        "flex w-[356px] items-center gap-3 rounded-card border border-border bg-surface py-3 pr-3 pl-3.5 text-sm shadow-md",
        className,
      )}
      {...props}
    >
      <span className="[&_svg]:size-5 [&_svg]:text-success-fg">{icon}</span>
      <div className="grid min-w-0 flex-1 leading-tight">
        {title ? <span className="font-medium text-fg">{title}</span> : null}
        {children ? <span className="text-[12.5px] text-muted">{children}</span> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
