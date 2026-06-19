import type { ReactNode } from "react";

/** Centered empty/zero state: optional icon, title, supporting copy, optional action. */
export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-border px-6 py-14 text-center">
      {icon ? <div className="text-3xl">{icon}</div> : null}
      <p className="text-base font-medium text-fg">{title}</p>
      {description ? <p className="max-w-sm text-sm text-muted">{description}</p> : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
