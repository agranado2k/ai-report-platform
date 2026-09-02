import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";

// An inline message block (report §07): a soft-tinted surface with a leading
// icon column, a title, body copy, and an optional trailing action. Tones use
// the -soft fill + -fg text tier so the copy clears WCAG AA on the light
// ground. The icon is the CALLER's (InfoIcon / AlertTriangleIcon / …) so the
// primitive owns no icon set.
export type BannerTone = "info" | "warning" | "danger" | "success";

const tones: Record<BannerTone, string> = {
  info: "bg-info-soft border-info/30 text-info-fg",
  warning: "bg-warning-soft border-warning/40 text-warning-fg",
  danger: "bg-danger-soft border-danger/30 text-danger-fg",
  success: "bg-success-soft border-success/30 text-success-fg",
};

export function Banner({
  tone = "info",
  icon,
  title,
  action,
  className,
  children,
  ...props
}: Omit<ComponentProps<"div">, "title"> & {
  tone?: BannerTone;
  icon?: ReactNode;
  title?: ReactNode;
  action?: ReactNode;
}) {
  // An error must be announced assertively; polite `status` would defer it.
  const role = tone === "danger" ? "alert" : "status";
  return (
    <div
      role={role}
      className={cx(
        "grid grid-cols-[1rem_1fr_auto] items-start gap-x-3 gap-y-0.5 rounded-control border px-4 py-3 text-sm",
        tones[tone],
        className,
      )}
      {...props}
    >
      <span className="mt-0.5 [&_svg]:size-4">{icon}</span>
      <div className="min-w-0">
        {title ? <div className="font-medium text-fg">{title}</div> : null}
        {children ? <div className="text-muted">{children}</div> : null}
      </div>
      {action ? <div className="col-start-3 row-start-1 self-center">{action}</div> : null}
    </div>
  );
}
