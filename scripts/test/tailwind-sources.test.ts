// Tailwind v4 discovers utility classes by scanning source files automatically,
// but that scan skips anything resolved through node_modules — which is exactly
// how each app reaches the shared `arp-ui` workspace package. A class used ONLY
// inside packages/ui (the primary Button's `bg-brand text-on-brand`, the Badge
// fills) therefore never reaches the compiled stylesheet, and the component
// renders unstyled. Each app's Tailwind entry must opt the package in with an
// explicit `@source`. This pins that for every app that imports the theme.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const APPS = ["apps/app", "apps/view"] as const;

describe("Tailwind entries scan the shared arp-ui package for utilities", () => {
  for (const app of APPS) {
    it(`${app}/app/tailwind.css declares @source for packages/ui/src`, () => {
      const entry = readFileSync(path.join(ROOT, app, "app/tailwind.css"), "utf8");
      const sources = [...entry.matchAll(/@source\s+"([^"]+)"/g)].map((m) => m[1]);
      const resolved = sources.map((s) => path.resolve(path.join(ROOT, app, "app"), s ?? ""));
      expect(resolved, `${app} must @source the arp-ui package`).toContain(
        path.join(ROOT, "packages/ui/src"),
      );
    });
  }
});
