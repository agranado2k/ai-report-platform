import { Link } from "@remix-run/react";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  cx,
  InfoIcon,
  Toast,
  type ToastTone,
  XIcon,
} from "arp-ui";
import type { ReactNode } from "react";
import type { ToastDescriptor } from "./toast";

// The presentational toast stack (#336, report Z0W60dI8hu §08): bottom-right,
// 24px offset, at most three visible. Prop-driven — the ToastRegion island owns
// the state (flash reads, the client-toast event, the auto-dismiss timers); this
// owns the look only, so it is node-render smoke-testable. Each toast carries at
// most one action (Undo/Open/View) plus a dismiss.

const toneIcon: Record<ToastTone, ReactNode> = {
  success: <CheckCircleIcon />,
  danger: <AlertTriangleIcon />,
  info: <InfoIcon />,
  neutral: <InfoIcon />,
};

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: readonly ToastDescriptor[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div
      // Bottom-right region, above dialogs. aria-live is polite for the stack;
      // an individual danger toast escalates to role="alert" inside <Toast>.
      className="pointer-events-none fixed right-6 bottom-6 z-50 flex flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <Toast
          key={t.id}
          tone={t.tone}
          icon={toneIcon[t.tone]}
          title={t.title}
          className="pointer-events-auto"
          action={
            <div className="flex items-center gap-1">
              {t.actionLabel && t.actionHref ? (
                <Link
                  to={t.actionHref}
                  className="rounded-control px-2 py-1 text-xs font-medium text-brand no-underline transition-colors hover:bg-hover"
                >
                  {t.actionLabel}
                </Link>
              ) : null}
              <button
                type="button"
                onClick={() => onDismiss(t.id)}
                aria-label="Dismiss"
                className={cx(
                  "flex size-6 items-center justify-center rounded-control text-subtle transition-colors",
                  "hover:bg-hover hover:text-fg [&_svg]:size-3.5",
                )}
              >
                <XIcon />
              </button>
            </div>
          }
        >
          {t.description}
        </Toast>
      ))}
    </div>
  );
}
