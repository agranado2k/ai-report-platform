import { UserButton } from "@clerk/remix";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Outlet, useLoaderData, useLocation } from "@remix-run/react";
import { KeyIcon } from "arp-ui";
import { CommandPalette } from "../components/command/CommandPalette";
import type { PaletteReport } from "../components/command/command-palette";
import { ToastRegion } from "../components/feedback/ToastRegion";
import { AppShell } from "../components/shell/AppShell";
import type { NavFolder } from "../components/shell/shell-nav";
import { resolveActorForRead } from "../server/auth.server";
import { appOrigin, ops } from "../server/container.server";
import { visibleFolderTree } from "../server/folder-sharing.server";
import { mcpEndpointFrom } from "../server/mcp-endpoint";

// The pathless `_app` layout (#333, /grill-me 2026-09-02): the persistent
// signed-in shell wraps the authenticated UI routes (`_app._index`,
// `_app.upload`, `_app.settings.api-keys`). Public routes (sign-in/sign-up/
// unlock/health) and resource routes stay top-level, so they render with no
// shell. The loader fetches the VISIBLE folder list ONCE for the nav tree —
// lightweight (id/parentId/name only), no per-folder counts (the count is a
// documented N+1; a grouped query lights it up later, #343).
// The ⌘K palette's report index is a bounded, newest-first slice — enough to
// jump to something recent without paying for the whole library on every app
// page load (deeper search still lives on the dashboard's `?q=`). Client-safe:
// slug + title only.
const PALETTE_REPORTS_LIMIT = 50;

export async function loader(args: LoaderFunctionArgs) {
  const actorR = await resolveActorForRead(args);
  const actor = actorR.ok ? actorR.value : null;
  let navFolders: NavFolder[] = [];
  let paletteReports: PaletteReport[] = [];
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
    // Visibility-scoped (ADR-0075), same seam the dashboard list uses — the
    // palette only ever lists what this user may already see.
    const reportsR = await ops().searchReports(
      { orgId: actor.orgId, userId: actor.userId },
      { limit: PALETTE_REPORTS_LIMIT },
    );
    if (reportsR.ok) {
      paletteReports = reportsR.value.items.map((r) => ({ slug: r.slug, title: r.title }));
    }
  }
  return json({
    navFolders,
    paletteReports,
    mcpEndpoint: mcpEndpointFrom(appOrigin(args.request)),
  });
}

export default function AppLayout() {
  const { navFolders, paletteReports, mcpEndpoint } = useLoaderData<typeof loader>();
  const location = useLocation();
  const selectedFolderId = new URLSearchParams(location.search).get("folder");

  // The palette (⌘K) + toast region are fixed-position overlays that ride ABOVE
  // the shell on every signed-in page, so they live here alongside <AppShell>
  // rather than inside it — which keeps AppShell a pure, prop-only surface. The
  // folder index for the palette reuses the nav list already loaded.
  const paletteFolders = navFolders.map((f) => ({ id: f.id, name: f.name }));

  return (
    <>
      <CommandPalette reports={paletteReports} folders={paletteFolders} mcpEndpoint={mcpEndpoint} />
      <ToastRegion />
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
    </>
  );
}
