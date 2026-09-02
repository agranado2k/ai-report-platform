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
} from "arp-ui";
import { type ComponentPropsWithoutRef, type ReactNode, useEffect, useState } from "react";
import { Logo } from "../Logo";
import { Breadcrumbs } from "./Breadcrumbs";
import { FolderNavTree } from "./FolderNavTree";
import { crumbsFor, isRailToggle, type NavFolder } from "./shell-nav";

// The 2026 persistent app shell (#333, report Z0W60dI8hu §02): a sidebar on the
// page ground beside content on white. DATA is prop-driven (the _app layout
// passes it in) so the component is unit/smoke-testable with no Clerk context —
// the account control is an injected `account` slot, not a hardcoded
// <UserButton>. The only client state is the rail collapse (localStorage + ⌘B),
// which SSRs expanded. Folder NAVIGATION lives here; folder MANAGEMENT stays on
// the dashboard body (/grill-me 2026-09-02). Counts are deferred (#343).

const RAIL_KEY = "centaur.sidebar.collapsed";

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
    "flex h-8 items-center gap-2 rounded-control px-2 text-sm transition-colors [&_svg]:size-4 [&_svg]:shrink-0",
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

export function AppShell({
  navFolders,
  activePath,
  selectedFolderId,
  account,
  children,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Restore the persisted rail state and wire the ⌘B / Ctrl+B toggle. Guarded:
  // localStorage throws in private windows / when site data is blocked.
  useEffect(() => {
    try {
      if (localStorage.getItem(RAIL_KEY) === "1") setCollapsed(true);
    } catch {}
    const onKey = (e: KeyboardEvent) => {
      if (isRailToggle(e)) {
        e.preventDefault();
        setCollapsed((c) => {
          const next = !c;
          try {
            localStorage.setItem(RAIL_KEY, next ? "1" : "0");
          } catch {}
          return next;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggle = () =>
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(RAIL_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });

  const crumbs = crumbsFor(activePath, navFolders, selectedFolderId);

  return (
    <div className="grid h-dvh grid-rows-1 bg-surface" style={{ gridTemplateColumns: "auto 1fr" }}>
      <aside
        className={cx(
          "flex h-dvh flex-col gap-1 border-r border-border bg-bg p-2 transition-[width] duration-150",
          collapsed ? "w-14" : "w-64",
        )}
        data-collapsed={collapsed}
      >
        {/* Workspace / brand — also the way home. */}
        <Link
          to="/"
          aria-label="Centaur — your reports"
          className={cx(
            "flex h-11 items-center gap-2.5 rounded-control px-2 no-underline hover:bg-hover",
            collapsed && "justify-center px-0",
          )}
        >
          <Logo className="size-7 shrink-0" />
          {collapsed ? null : (
            <span className="font-serif text-lg font-semibold tracking-tight text-fg">Centaur</span>
          )}
        </Link>

        <nav className="mt-1 grid gap-px">
          <NavItem
            icon={<DocumentIcon />}
            label="Reports"
            href="/"
            active={activePath === "/"}
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
            active={activePath.startsWith("/settings")}
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
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={collapsed}
            title="Toggle sidebar (⌘B)"
            className={cx(buttonClass("ghost", "sm", { iconOnly: true }), "-ml-1")}
          >
            <PanelLeftIcon className="size-4" />
          </button>
          <Breadcrumbs crumbs={crumbs} />
          <div className="flex-1" />
          <Link to="/upload" className={buttonClass("primary", "sm")}>
            <UploadIcon className="size-4" />
            Upload report
          </Link>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
