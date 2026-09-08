import { useLocation } from "@remix-run/react";
import { useCallback, useEffect, useRef, useState } from "react";
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
//   1. A server mutation redirect that carries `?flash=<code>` — read from the
//      reactive `useLocation()` (this island lives in the persistent layout, so
//      a mount-only read would miss client-side navigations), consumed once per
//      navigation, then stripped from the URL so a refresh doesn't re-toast.
//   2. A client-raised `centaur:toast` CustomEvent (a palette action, an inline
//      rename outcome) — dispatched with a ToastDescriptor detail.
// Each toast auto-dismisses after 4s (report §08); the newest three are visible.

const AUTO_DISMISS_MS = 4000;

export function ToastRegion() {
  const [toasts, setToasts] = useState<readonly ToastDescriptor[]>([]);
  const location = useLocation();
  // The key of the last navigation whose flash we consumed — so the same flash
  // fires exactly once per navigation and never again on an unrelated re-render.
  const consumedFlashKey = useRef<string | null>(null);

  const dismiss = useCallback((id: string) => {
    setToasts((list) => dismissToast(list, id));
  }, []);

  const add = useCallback((toast: ToastDescriptor) => {
    setToasts((list) => pushToast(list, toast));
    // Auto-dismiss: the id is stable, so a later manual dismiss is idempotent.
    window.setTimeout(() => setToasts((list) => dismissToast(list, toast.id)), AUTO_DISMISS_MS);
  }, []);

  // Source 1: a mutation redirect's flash param. The region lives in the
  // PERSISTENT `_app` layout, which does not remount across client-side
  // navigations — so this reads the REACTIVE `useLocation()` (not the
  // non-reactive `window.location`) and re-runs whenever the router navigates.
  // The five redirecting mutations submit via <Form> and the action returns
  // `redirect(...?flash=...)`, which React Router follows in place; that changes
  // `location` (and its `key`) without a remount, and this effect fires. Each
  // navigation's flash is consumed exactly once (deduped on `location.key`), so
  // an unrelated re-render at the same location never re-toasts; the param is
  // then wiped from the address bar (replaceState, no navigation) so a hard
  // refresh doesn't re-toast either.
  useEffect(() => {
    if (consumedFlashKey.current === location.key) return;
    const flash = parseFlash(location.search);
    if (!flash) return;
    consumedFlashKey.current = location.key;
    add(toastForFlash(flash));
    const cleaned = stripFlashParams(location.search);
    window.history.replaceState(null, "", `${location.pathname}${cleaned}${location.hash}`);
  }, [location, add]);

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
