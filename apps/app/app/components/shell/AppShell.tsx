import { Link } from "@remix-run/react";
import {
  buttonClass,
  ChevronsUpDownIcon,
  ClockIcon,
  cx,
  DocumentIcon,
  KeyIcon,
  UploadIcon,
  UsersIcon,
  XIcon,
} from "arp-ui";
import {
  type ComponentPropsWithoutRef,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Logo } from "../Logo";
import { Breadcrumbs } from "./Breadcrumbs";
import { FolderNavTree } from "./FolderNavTree";
import {
  crumbsFor,
  isEditableTarget,
  isNavActive,
  isRailToggle,
  type NavFolder,
} from "./shell-nav";

// The 2026 persistent app shell (#333, report Z0W60dI8hu §02): a sidebar on the
// page ground beside content on white. DATA is prop-driven (the _app layout
// passes it in) so the component is unit/smoke-testable with no Clerk context —
// the account control is an injected `account` slot, not a hardcoded
// <UserButton>. Client state: the desktop rail collapse (localStorage + ⌘B,
// SSRs expanded) and the phone navigation (#403), which are independent — the
// phone navigation neither reads nor writes the rail preference. Folder
// NAVIGATION lives here; folder MANAGEMENT stays on the dashboard body
// (ADR-0087). Counts are deferred (#343).
//
// Below the `md` breakpoint the rail is not rendered and the navigation is a
// modal <dialog> opened from the header's Menu button: closed by default,
// closed by Escape, its Close button, the backdrop, choosing a destination, or
// the window growing to desktop width; focus returns to the Menu button.

const RAIL_KEY = "centaur.sidebar.collapsed";

/** Tailwind's `md` (48rem): the width from which the persistent rail shows. */
const DESKTOP_NAV_QUERY = "(min-width: 48rem)";

const NAV_DRAWER_ID = "app-nav-drawer";

/** A sidebar-collapse glyph (Lucide "panel-left") — local to the shell; the
 *  shared set doesn't carry it yet and this is its only use. */
function PanelLeftIcon(props: ComponentPropsWithoutRef<"svg">) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </svg>
  );
}

/** A menu glyph (Lucide "menu") — local to the shell, like PanelLeftIcon. */
function MenuIcon(props: ComponentPropsWithoutRef<"svg">) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

interface NavItemProps {
  icon: ReactNode;
  label: string;
  href?: string;
  active?: boolean;
  collapsed: boolean;
  /** Present-but-unbuilt (Shared with me / Recent) — shown, not linked. */
  soon?: boolean;
}

function NavItem({ icon, label, href, active, collapsed, soon }: NavItemProps) {
  const cls = cx(
    "flex h-11 items-center gap-2 rounded-control px-2 text-sm transition-colors md:h-8 [&_svg]:size-4 [&_svg]:shrink-0",
    active
      ? "bg-brand-soft font-medium text-brand-hover [&_svg]:text-brand-hover"
      : "text-fg hover:bg-hover [&_svg]:text-muted",
    soon && "cursor-default text-placeholder hover:bg-transparent [&_svg]:text-placeholder",
    collapsed && "justify-center px-0",
  );
  const inner = (
    <>
      {icon}
      {collapsed ? null : <span className="truncate">{label}</span>}
      {!collapsed && soon ? (
        <span className="ml-auto rounded-full bg-hover px-1.5 text-[10px] text-muted">soon</span>
      ) : null}
    </>
  );
  if (href && !soon) {
    return (
      <Link
        to={href}
        aria-current={active ? "page" : undefined}
        title={collapsed ? label : undefined}
        className={cx(cls, "no-underline")}
      >
        {inner}
      </Link>
    );
  }
  return (
    <span title={soon ? `${label} — coming soon` : label} aria-disabled={soon} className={cls}>
      {inner}
    </span>
  );
}

export interface AppShellProps {
  /** Client-safe visible folder list for the nav tree (id/parentId/name). */
  navFolders: readonly NavFolder[];
  /** Current URL pathname — drives active nav + breadcrumbs (passed by the layout). */
  activePath: string;
  /** The `?folder=` selection on the dashboard, for the folder trail + tree highlight. */
  selectedFolderId: string | null;
  /** The account control (Clerk <UserButton> at the route; a stub in tests). */
  account: ReactNode;
  children?: ReactNode;
}

/** The navigation itself — brand, primary nav, Folders, settings, account —
 *  rendered by the desktop rail and by the phone navigation alike, so the two
 *  can never offer different destinations. */
function ShellNav({
  navFolders,
  activePath,
  selectedFolderId,
  account,
  collapsed,
  close,
}: {
  navFolders: readonly NavFolder[];
  activePath: string;
  selectedFolderId: string | null;
  account: ReactNode;
  collapsed: boolean;
  /** The phone navigation's Close button, beside the brand. */
  close?: ReactNode;
}) {
  return (
    <>
      <div className="flex items-center gap-1">
        {/* Workspace / brand — also the way home. */}
        <Link
          to="/"
          aria-label="Centaur — your reports"
          className={cx(
            "flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-control px-2 no-underline hover:bg-hover",
            collapsed && "justify-center px-0",
          )}
        >
          <Logo className="size-7 shrink-0" />
          {collapsed ? null : (
            <span className="font-serif text-lg font-semibold tracking-tight text-fg">Centaur</span>
          )}
        </Link>
        {close}
      </div>

      <nav className="mt-1 grid gap-px">
        <NavItem
          icon={<DocumentIcon />}
          label="Reports"
          href="/"
          active={isNavActive(activePath, "/")}
          collapsed={collapsed}
        />
        <NavItem icon={<UsersIcon />} label="Shared with me" collapsed={collapsed} soon />
        <NavItem icon={<ClockIcon />} label="Recent" collapsed={collapsed} soon />
      </nav>

      {collapsed ? null : (
        <>
          <div className="mt-3 px-2 text-xs font-medium text-muted">Folders</div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <FolderNavTree folders={navFolders} selectedId={selectedFolderId} />
          </div>
        </>
      )}
      {collapsed ? <div className="flex-1" /> : null}

      <nav className="grid gap-px border-t border-border pt-2">
        <NavItem
          icon={<KeyIcon />}
          label="API keys & MCP"
          href="/settings/api-keys"
          active={isNavActive(activePath, "/settings")}
          collapsed={collapsed}
        />
      </nav>

      {/* Account — the injected Clerk control (workspace switcher's counterpart). */}
      <div
        className={cx(
          "flex items-center gap-2 rounded-control p-1",
          collapsed ? "justify-center" : "hover:bg-hover",
        )}
      >
        {account}
        {collapsed ? null : (
          <ChevronsUpDownIcon className="ml-auto size-4 shrink-0 text-placeholder" />
        )}
      </div>
    </>
  );
}

export function AppShell({
  navFolders,
  activePath,
  selectedFolderId,
  account,
  children,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDialogElement>(null);

  // One persist-and-flip, shared by the ⌘B chord and the header button so the
  // two entry points can't drift. localStorage is guarded: it throws in
  // private windows / when site data is blocked.
  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(RAIL_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  }, []);

  // Restore the persisted rail state and wire the ⌘B / Ctrl+B toggle.
  useEffect(() => {
    try {
      if (localStorage.getItem(RAIL_KEY) === "1") setCollapsed(true);
    } catch {}
    const onKey = (e: KeyboardEvent) => {
      if (!isRailToggle(e)) return;
      // Don't swallow the chord while the user is typing in a field (e.g. the
      // upload form or an api-keys input) — only toggle when focus is chrome.
      if (isEditableTarget(e.target as HTMLElement | null)) return;
      e.preventDefault();
      toggleCollapsed();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleCollapsed]);

  const closeNav = useCallback(() => {
    setNavOpen(false);
    menuButtonRef.current?.focus();
  }, []);

  // The <dialog> follows the state: showModal() gives the page behind it
  // modal inertness and puts focus inside; close() hands it back.
  useEffect(() => {
    const drawer = drawerRef.current;
    if (!drawer) return;
    if (navOpen && !drawer.open) drawer.showModal();
    if (!navOpen && drawer.open) drawer.close();
  }, [navOpen]);

  // Growing to desktop width shows the rail; the phone navigation must not
  // stay open, invisible, holding the page inert.
  useEffect(() => {
    const desktop = window.matchMedia(DESKTOP_NAV_QUERY);
    const onChange = () => {
      if (desktop.matches) setNavOpen(false);
    };
    desktop.addEventListener("change", onChange);
    return () => desktop.removeEventListener("change", onChange);
  }, []);

  // Choosing any destination closes the navigation — including the page
  // already shown, where no route change would.
  const onDrawerClick = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget) {
      closeNav(); // the backdrop
      return;
    }
    if ((e.target as Element).closest("a[href]")) closeNav();
  };

  const crumbs = crumbsFor(activePath, navFolders, selectedFolderId);
  const navProps = { navFolders, activePath, selectedFolderId, account };

  return (
    <div className="grid h-dvh grid-cols-[minmax(0,1fr)] grid-rows-1 bg-surface md:grid-cols-[auto_minmax(0,1fr)]">
      <aside
        className={cx(
          "hidden h-dvh flex-col gap-1 border-r border-border bg-bg p-2 transition-[width] duration-150 md:flex",
          collapsed ? "w-14" : "w-64",
        )}
        data-collapsed={collapsed}
      >
        <ShellNav {...navProps} collapsed={collapsed} />
      </aside>

      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the click handler only
          catches the backdrop (whose keyboard equivalent is Escape, handled by
          onCancel) and bubbled link activations (Enter on a link fires click). */}
      <dialog
        id={NAV_DRAWER_ID}
        ref={drawerRef}
        aria-label="Navigation"
        onCancel={(e) => {
          e.preventDefault(); // Escape: close through state so focus returns
          closeNav();
        }}
        onClick={onDrawerClick}
        className="m-0 h-dvh max-h-none w-72 max-w-[calc(100vw-3rem)] border-r border-border bg-bg p-0 backdrop:bg-fg/40 md:hidden"
      >
        {navOpen ? (
          <div className="flex h-full flex-col gap-1 p-2">
            <ShellNav
              {...navProps}
              collapsed={false}
              close={
                <button
                  type="button"
                  onClick={closeNav}
                  aria-label="Close navigation"
                  className={cx(buttonClass("ghost", "sm", { iconOnly: true }), "size-11")}
                >
                  <XIcon className="size-5" />
                </button>
              }
            />
          </div>
        ) : null}
      </dialog>

      <div className="flex min-w-0 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-2 md:h-11 md:px-4">
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            aria-expanded={navOpen}
            aria-controls={NAV_DRAWER_ID}
            className={cx(buttonClass("ghost", "sm", { iconOnly: true }), "size-11 md:hidden")}
          >
            <MenuIcon className="size-5" />
          </button>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={collapsed}
            title="Toggle sidebar (⌘B)"
            className={cx(
              buttonClass("ghost", "sm", { iconOnly: true }),
              "-ml-1 hidden md:inline-flex",
            )}
          >
            <PanelLeftIcon className="size-4" />
          </button>
          <Breadcrumbs crumbs={crumbs} />
          <Link to="/upload" className={cx(buttonClass("primary", "sm"), "shrink-0 max-md:h-11")}>
            <UploadIcon className="size-4" />
            {/* "Upload" on a phone, "Upload report" from `sm` — the accessible
                name is "Upload report" at every width. */}
            <span>
              Upload<span className="max-sm:sr-only"> report</span>
            </span>
          </Link>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
