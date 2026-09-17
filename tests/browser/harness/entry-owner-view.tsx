// A minimal harness app that mounts the REAL `OwnerViewChrome` (resolved
// against apps/view — build.mts bundles with `resolveDir` there) so the browser
// tier can exercise the owner view's hash behaviour (ADR-0079, ADR-0089 §2).
//
// apps/view has no jsdom/component tier (vitest is `environment: "node"`), so
// "the hash is adopted once at load and NOT re-read afterwards" is expressible
// nowhere else: it is a statement about mounting, an effect, and a later
// `hashchange` — none of which a static SSR render can observe. The pure half
// (what `reportFrameSrc` builds from a given hash) is unit-tested in
// `apps/view/app/view/frame.test.ts`; this is the composition.
//
// No loader, no router, no network. The chrome is handed plain props, exactly
// as `$slug_.view.tsx` hands it `useLoaderData()`. The framed `/<slug>` will
// not resolve over `file://` and is not meant to — every assertion here is
// about the iframe ELEMENT (its `src` attribute and its identity), never about
// what loads inside it. That is the framing project's job, over a real origin.
//
// The props are read off the harness page's own QUERY STRING so one built page
// serves every case the specs need. The alternative — an entry file per case —
// would multiply esbuild bundles for what is a difference of two props, and
// the fragment is already spoken for (it is the thing under test in
// `owner-view-chrome.spec.ts`), so the query is the only channel left. Absent
// params give exactly the props this entry hard-coded before, so the existing
// hash specs navigate unchanged.
import { createRoot } from "react-dom/client";
import { OwnerViewChrome } from "./app/view/components/OwnerViewChrome";

const params = new URLSearchParams(window.location.search);

// `?lossy=1` mounts the ADR-0090 Edit-confirm case; `?lossy=unnamed` mounts the
// degenerate one `loadLossyWarning` returns when the recorded verdict stands
// but the bytes could not be re-read, which has its own copy.
const lossy = params.get("lossy");
const lossyWarning =
  lossy === "1"
    ? { lostElements: ["script", "svg"], lostAttributes: ["onclick"] }
    : lossy === "unnamed"
      ? { lostElements: [], lostAttributes: [] }
      : null;

createRoot(document.getElementById("root") as HTMLElement).render(
  <OwnerViewChrome
    slug="abcde12345"
    docTitle="Q3 roadmap review"
    shareState="Private"
    canEdit={params.get("canEdit") !== "0"}
    lossyWarning={lossyWarning}
  />,
);
