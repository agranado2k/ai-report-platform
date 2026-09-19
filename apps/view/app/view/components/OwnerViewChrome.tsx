// The owner view's whole client surface: the chrome strip over the framed
// report (ADR-0089 §1/§2).
//
// Split out of `routes/$slug_.view.tsx` so it can be MOUNTED without a Remix
// router. The route's default export is now `useLoaderData()` plus this
// component, which means the browser tier can drive the real thing
// (`tests/browser/harness/entry-owner-view.tsx`) instead of a hand-written
// stand-in. apps/view has no jsdom tier (vitest is `environment: "node"`), so
// without this seam the hash behaviour below was untestable anywhere — and it
// was: dropping the forwarding used to break `#3` silently.
import { useEffect, useState } from "react";
import type { LossyWarning } from "../lossy-warning";
import { OwnerViewTopBar } from "./OwnerViewTopBar";
import { ReportFrame } from "./ReportFrame";

export interface OwnerViewChromeProps {
  readonly slug: string;
  /** The report's title. Author-controlled — rendered as a text node, never
   *  interpolated into markup (ADR-0089 §6). */
  readonly docTitle: string;
  /** How the report is shared, already resolved to display copy by the loader
   *  from the ADR-0078 `Report sharing state`. This component decides nothing. */
  readonly shareState: string;
  /** False on the owner-read degrade — withholds Versions and Edit both. */
  readonly canEdit: boolean;
  /** ADR-0090 — what an editor save would drop, or `null` when the live
   *  version is `lossless` or was never probed. Resolved by the loader
   *  (`../lossy-warning.ts`); this component only carries it to the bar. */
  readonly lossyWarning: LossyWarning | null;
}

export function OwnerViewChrome({
  slug,
  docTitle,
  shareState,
  canEdit,
  lossyWarning,
}: OwnerViewChromeProps) {
  // The hash is forwarded AT LOAD, once, and never again (ticket #361 AC 4).
  //
  // It starts empty and is adopted in an effect rather than read during
  // render, because the server never receives a fragment: reading
  // `window.location.hash` on the first render would make the client's markup
  // disagree with the server's and trip a hydration mismatch.
  //
  // There is deliberately NO `hashchange` listener and no `key={hash}` remount.
  // Both were here, and together they reloaded the framed report on every
  // top-level hash change — throwing away whatever state the report had built
  // up (deck position, scroll, any JS state) to honour a navigation the report
  // may well have caused itself. A report that sets its own hash while the
  // owner reads it would have been restarting itself. The spec asks that the
  // hash be forwarded at load; it does not ask for a live channel, and a live
  // channel here costs more than it pays for.
  const [hash, setHash] = useState("");
  useEffect(() => {
    setHash(window.location.hash);
  }, []);

  return (
    <div className="flex h-dvh flex-col overflow-hidden" data-testid="owner-view">
      <OwnerViewTopBar
        docTitle={docTitle}
        shareState={shareState}
        // The always-present escape to the top-level report (ADR-0092, #385):
        // the CANONICAL `/<slug>`, which the framed navigation's `Path=/<slug>`
        // unlock cookie already serves, opened in a new tab where storage works.
        openHref={`/${slug}`}
        // Two props, two values (#377). Version history lives in the editor's
        // own side panel, so Versions is a deep-link INTO the editor rather
        // than a second destination — and `?panel=versions` is what makes it
        // actually arrive there. Without the param this landed the owner in
        // the editor with the panel CLOSED on the comments tab: one click
        // short of what they asked for, with nothing to say why.
        //
        // The param is a hint the editor reads once at mount
        // (`../../edit/panel.ts`), not a capability. It changes no gate and
        // widens nothing: this href still points at `/<slug>/edit`, which
        // holds no capability under that Path and funnels through the app's
        // one mint to re-check `canWrite` live (ADR-0089 §4b), exactly as
        // before.
        versionsHref={`/${slug}/edit?panel=versions`}
        editHref={`/${slug}/edit`}
        canEdit={canEdit}
        lossyWarning={lossyWarning}
      />
      <main className="min-h-0 flex-1">
        <ReportFrame slug={slug} hash={hash} title={docTitle} />
      </main>
    </div>
  );
}
