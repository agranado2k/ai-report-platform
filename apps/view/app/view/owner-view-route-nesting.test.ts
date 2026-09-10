import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The same structural guard `edit-route-nesting.test.ts` puts on the editor,
// for the same P0 reason (ADR-0063 Phase 5-F): as `$slug.view.tsx` the owner
// view would dot-nest UNDER `$slug.tsx`, so `GET /:slug/view` would run the
// PUBLIC viewer's loader first — which redirects any private report to
// `${appOrigin}/unlock/{slug}` before this loader ever runs. The owner would
// be asked to "unlock" their own report, which is exactly the incident that
// bug caused the first time. The trailing `_` opts out of the nesting.
const routesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "routes");
const routeFiles = readdirSync(routesDir);

describe("view /<slug>/view route is not nested under the public viewer", () => {
  it("uses the de-nested `$slug_.view.tsx`", () => {
    expect(routeFiles).toContain("$slug_.view.tsx");
  });

  it("does NOT use `$slug.view.tsx` (which would re-parent it under $slug.tsx)", () => {
    expect(routeFiles).not.toContain("$slug.view.tsx");
  });
});
