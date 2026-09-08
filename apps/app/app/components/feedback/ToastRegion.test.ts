// @vitest-environment jsdom
// Interaction test for the toast-region island's FLASH-ON-NAVIGATION wiring
// (#336). The region is mounted once in the persistent `_app` layout, which does
// NOT remount across client-side navigations — so a mount-only flash read never
// fires when a redirecting mutation (create/rename/delete folder, move/delete
// report) lands us on `?flash=<code>` via React Router's in-place navigation.
// This pins the fix: the flash read is reactive to `useLocation()`, and each
// flash is consumed exactly once per navigation (deduped on `location.key`).
// The pure model (parse/map/reducer) is unit-tested in toast.ts; this proves the
// island re-reads on navigation, which the SSR smoke tier cannot reach.
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// React 18's createRoot warns (and skips act batching) without this flag.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface FakeLocation {
  pathname: string;
  search: string;
  hash: string;
  key: string;
  state: unknown;
}

// The mutable location the mock reads. The test advances it (a new object with a
// new `key`) to simulate a client-side navigation, exactly as React Router does
// when an action returns a redirect the router follows in place.
let currentLocation: FakeLocation = {
  pathname: "/",
  search: "",
  hash: "",
  key: "default",
  state: null,
};

vi.mock("@remix-run/react", () => ({
  useLocation: () => currentLocation,
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) =>
    h("a", { href: to, ...rest }, children),
}));

const { ToastRegion } = await import("./ToastRegion");

let container: HTMLDivElement;
let root: Root;

const toastCount = () => container.querySelectorAll('button[aria-label="Dismiss"]').length;

beforeEach(() => {
  currentLocation = { pathname: "/", search: "", hash: "", key: "default", state: null };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("ToastRegion — flash on client-side navigation", () => {
  it("raises a toast when a client navigation lands on a URL carrying ?flash=", () => {
    // Mounted on a plain URL (the persistent layout): no flash, no toast.
    act(() => {
      root.render(h(ToastRegion));
    });
    expect(container.textContent).not.toContain("Folder created");
    expect(toastCount()).toBe(0);

    // A redirecting mutation returns `redirect(...?flash=folder-created)`, which
    // React Router follows as an IN-PLACE client navigation: same region
    // instance, new location, new key — no remount. The mount-only reader never
    // sees this; the reactive reader must.
    currentLocation = {
      pathname: "/",
      search: "?flash=folder-created",
      hash: "",
      key: "nav-1",
      state: null,
    };
    act(() => {
      root.render(h(ToastRegion));
    });

    expect(container.textContent).toContain("Folder created");
    expect(toastCount()).toBe(1);
  });

  it("consumes each flash once — an unrelated re-render on the same location does not re-fire", () => {
    act(() => {
      root.render(h(ToastRegion));
    });

    currentLocation = {
      pathname: "/",
      search: "?flash=folder-created",
      hash: "",
      key: "nav-1",
      state: null,
    };
    act(() => {
      root.render(h(ToastRegion));
    });
    expect(toastCount()).toBe(1);

    // A re-render at the SAME location (e.g. a parent state change) must not add
    // a second copy of the same flash.
    act(() => {
      root.render(h(ToastRegion));
    });
    expect(toastCount()).toBe(1);
  });
});
