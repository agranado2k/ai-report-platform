import { useCallback, useEffect, useState } from "react";
import { ToastStack } from "./ToastStack";
import {
  dismissToast,
  parseFlash,
  pushToast,
  stripFlashParams,
  TOAST_EVENT,
  type ToastDescriptor,
  toastForFlash,
} from "./toast";

// The toast region island (#336, report Z0W60dI8hu §08). Mounted once in the app
// shell. Two sources raise a toast; both flow through the pure model in toast.ts
// (parse/map/reducer are unit-tested there, so this island stays a thin wrapper):
//   1. A server mutation redirect that carries `?flash=<code>` — read on mount,
//      then stripped from the URL so a refresh doesn't re-toast.
//   2. A client-raised `centaur:toast` CustomEvent (a palette action, an inline
//      rename outcome) — dispatched with a ToastDescriptor detail.
// Each toast auto-dismisses after 4s (report §08); the newest three are visible.

const AUTO_DISMISS_MS = 4000;

export function ToastRegion() {
  const [toasts, setToasts] = useState<readonly ToastDescriptor[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((list) => dismissToast(list, id));
  }, []);

  const add = useCallback((toast: ToastDescriptor) => {
    setToasts((list) => pushToast(list, toast));
    // Auto-dismiss: the id is stable, so a later manual dismiss is idempotent.
    window.setTimeout(() => setToasts((list) => dismissToast(list, toast.id)), AUTO_DISMISS_MS);
  }, []);

  // Source 1: a mutation redirect's flash param. Read once on mount, then wiped
  // from the address bar (replaceState, no navigation) so it fires exactly once.
  useEffect(() => {
    const flash = parseFlash(window.location.search);
    if (!flash) return;
    add(toastForFlash(flash));
    const cleaned = stripFlashParams(window.location.search);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${cleaned}${window.location.hash}`,
    );
  }, [add]);

  // Source 2: client-raised toasts over the decoupled DOM event.
  useEffect(() => {
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<ToastDescriptor>).detail;
      if (detail) add(detail);
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, [add]);

  return <ToastStack toasts={toasts} onDismiss={dismiss} />;
}
