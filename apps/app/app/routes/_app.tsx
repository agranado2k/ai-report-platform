import { UserButton } from "@clerk/remix";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Outlet, useLoaderData, useLocation } from "@remix-run/react";
import { KeyIcon } from "arp-ui";
import { AppShell } from "../components/shell/AppShell";
import type { NavFolder } from "../components/shell/shell-nav";
import { resolveActorForRead } from "../server/auth.server";
import { ops } from "../server/container.server";
import { visibleFolderTree } from "../server/folder-sharing.server";

// The pathless `_app` layout (#333, /grill-me 2026-09-02): the persistent
// signed-in shell wraps the authenticated UI routes (`_app._index`,
// `_app.upload`, `_app.settings.api-keys`). Public routes (sign-in/sign-up/
// unlock/health) and resource routes stay top-level, so they render with no
// shell. The loader fetches the VISIBLE folder list ONCE for the nav tree —
// lightweight (id/parentId/name only), no per-folder counts (the count is a
// documented N+1; a grouped query lights it up later, #343).
export async function loader(args: LoaderFunctionArgs) {
  const actorR = await resolveActorForRead(args);
  const actor = actorR.ok ? actorR.value : null;
  let navFolders: NavFolder[] = [];
  if (actor) {
    const foldersR = await ops().listFolders({ orgId: actor.orgId, userId: actor.userId }, {});
    if (foldersR.ok) {
      // visibleFolderTree already grafts folders whose ancestors are invisible
      // to Root (ADR-0076); we keep only the nav-relevant fields.
      navFolders = visibleFolderTree(foldersR.value.items).map((n) => ({
        id: n.id,
        parentId: n.parentId,
        name: n.name,
      }));
    }
  }
  return json({ navFolders });
}

export default function AppLayout() {
  const { navFolders } = useLoaderData<typeof loader>();
  const location = useLocation();
  const selectedFolderId = new URLSearchParams(location.search).get("folder");

  return (
    <AppShell
      navFolders={navFolders}
      activePath={location.pathname}
      selectedFolderId={selectedFolderId}
      account={
        // The account control (moved here from the old TopBar): Clerk's
        // <UserButton> with the "API keys & MCP" link grafted in, keeping
        // native Manage-account / Sign-out.
        <UserButton afterSignOutUrl="/">
          <UserButton.MenuItems>
            <UserButton.Link
              label="API keys & MCP"
              labelIcon={<KeyIcon className="size-4" />}
              href="/settings/api-keys"
            />
            <UserButton.Action label="manageAccount" />
            <UserButton.Action label="signOut" />
          </UserButton.MenuItems>
        </UserButton>
      }
    >
      <Outlet />
    </AppShell>
  );
}
