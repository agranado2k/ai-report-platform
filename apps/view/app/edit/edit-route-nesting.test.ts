import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Regression guard for the P0 fix (fix/view-edit-route-nesting). The unified
// editor route MUST be named `$slug_.edit.tsx` — the trailing `_` on the
// `$slug_` segment opts it OUT of Remix v2 flat-route dot-nesting. As
// `$slug.edit.tsx` it nests UNDER `$slug.tsx` (the public viewer), so
// `GET /:slug/edit` runs the parent viewer loader first, which redirects any
// PRIVATE report to `${appOrigin}/unlock/{slug}` before the editor loader ever
// runs — the editor becomes structurally unreachable for private reports (an
// owner is told to "unlock" their own report). This shipped undetected from
// #184 because no unit test exercised real Remix route resolution; this file is
// the cheap structural guard, and the 4c cross-origin e2e is the render-level
// one. If someone renames the file back to `$slug.edit.tsx`, this fails.
const routesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "routes");
const routeFiles = readdirSync(routesDir);

describe("view /edit route is not nested under the public viewer", () => {
  it("uses the de-nested `$slug_.edit.tsx` (trailing underscore opts out of nesting)", () => {
    expect(routeFiles).toContain("$slug_.edit.tsx");
  });

  it("does NOT use `$slug.edit.tsx` (which would re-parent it under $slug.tsx → private reports unlock-wall the editor)", () => {
    expect(routeFiles).not.toContain("$slug.edit.tsx");
  });
});
