import type { ReactNode } from "react";

/** App page header: a title row with optional right-aligned actions (e.g. UserButton). */
export function AppHeader({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 pb-6">
      <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </header>
  );
}
