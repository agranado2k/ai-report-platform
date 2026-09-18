// A minimal harness app that mounts the editor's REAL side-panel chrome
// (`PanelHeader` / `PanelToggle`, resolved against apps/view — build.mts
// bundles with `resolveDir` there) seeded by the REAL `initialPanelState`,
// read off the page's own query string exactly as `$slug_.edit.tsx` reads it
// off the route's (ADR-0079, #382).
//
// WHY IT EXISTS. The last hop of the panel hint is the editor MOUNTING with
// the panel already open — a lazy `useState` initialiser that runs once, at
// mount, from the URL. apps/view has no jsdom/component tier (vitest is
// `environment: "node"`), so the composition "this URL produces that panel"
// is expressible nowhere else: the node tier can only ask `initialPanelState`
// what it returns, never whether anything renders it.
//
// NOT THE WHOLE `/edit` ROUTE, deliberately. The route needs loader data, an
// edit token, a document and a cross-origin comments client; none of that
// bears on the hint, and mounting it here would buy a slower test with more
// ways to fail for reasons the ticket is not about. What is real is what the
// claim rests on: the seed function, the panel chrome, and a browser.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { PanelHeader, PanelToggle } from "./app/edit/components/PanelChrome";
import {
  closePanel,
  initialPanelState,
  openPanel,
  type PanelState,
  selectPanelTab,
} from "./app/edit/panel";

function EditorPanelShell() {
  // The route's own line, verbatim in shape: a LAZY initialiser (seed state,
  // read once) over the `panel` search param. `useSearchParams` there, plain
  // `URLSearchParams` here — there is no router in the harness, and the route
  // uses one only so the server and the first client render agree.
  const [panel, setPanel] = useState<PanelState>(() =>
    initialPanelState(new URLSearchParams(window.location.search).get("panel")),
  );

  return (
    <div className="pane-row" data-testid="edit-panel-harness">
      <div className="doc-pane" />
      {panel.open ? (
        // `data-tab` mirrors the state the real route branches its panel BODY
        // on (`panel.tab === "comments" ? <CommentsPanel/> : <VersionsPanel/>`)
        // without mounting either — both are cross-origin data clients, and
        // which one renders is not what this spec is about.
        <aside className="side-panel" data-testid="side-panel" data-tab={panel.tab}>
          <PanelHeader
            tab={panel.tab}
            unresolvedCount={0}
            onSelectTab={(tab) => setPanel((p) => selectPanelTab(p, tab))}
            onClose={() => setPanel((p) => closePanel(p))}
          />
        </aside>
      ) : (
        <PanelToggle unresolvedCount={0} onOpen={() => setPanel(openPanel("comments"))} />
      )}
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<EditorPanelShell />);
