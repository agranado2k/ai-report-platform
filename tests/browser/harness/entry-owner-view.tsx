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
import { createRoot } from "react-dom/client";
import { OwnerViewChrome } from "./app/view/components/OwnerViewChrome";

createRoot(document.getElementById("root") as HTMLElement).render(
  <OwnerViewChrome slug="abcde12345" docTitle="Q3 roadmap review" shareState="Private" canEdit />,
);
