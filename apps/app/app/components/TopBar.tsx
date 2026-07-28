import { UserButton } from "@clerk/remix";
import { Link } from "@remix-run/react";
import { buttonClass, KeyIcon, UploadIcon } from "arp-ui";
import { Logo } from "./Logo";

/**
 * Global app chrome for signed-in pages: Centaur brand, the primary Upload
 * action, and the account menu. Rendered once in the root (inside <SignedIn>),
 * so it sits above every authenticated route's PageShell. The account dropdown
 * is Clerk's <UserButton> with a custom "API keys & MCP" link grafted in via
 * <UserButton.MenuItems> — keeping Clerk's native Manage-account / Sign-out.
 */
export function TopBar() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-4 px-6">
        <Link to="/" aria-label="Centaur — your reports" className="flex items-center gap-2.5">
          <Logo className="h-6 w-6" />
          <span className="font-serif text-lg font-semibold tracking-tight text-fg">Centaur</span>
        </Link>
        <div className="flex-1" />
        <Link to="/upload" className={buttonClass("primary", "sm")}>
          <UploadIcon className="h-4 w-4" />
          Upload
        </Link>
        <UserButton afterSignOutUrl="/">
          <UserButton.MenuItems>
            <UserButton.Link
              label="API keys & MCP"
              labelIcon={<KeyIcon className="h-4 w-4" />}
              href="/settings/api-keys"
            />
            <UserButton.Action label="manageAccount" />
            <UserButton.Action label="signOut" />
          </UserButton.MenuItems>
        </UserButton>
      </div>
    </header>
  );
}
