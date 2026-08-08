#!/usr/bin/env node
// Regenerate tests/evals/fixtures/ from apps/mcp/src. `pnpm evals:sync`.
//
// Why a bundle step: `build-fixtures.ts` reaches into `apps/mcp/src/tools.ts`,
// whose runtime imports (`zod`, `arp-domain`) are apps/mcp's, not the root's.
// esbuild (already a devDependency, and the same tool apps/mcp's own build
// uses) inlines the TypeScript and the `arp-domain` workspace source, leaves
// `zod` external, and we drop the bundle INSIDE `apps/mcp/node_modules` so
// Node resolves that external the same way `apps/mcp` itself would.
//
// The generated files are checked in on purpose: the CI eval job must be able
// to run `promptfoo eval` straight from a checkout with no build step, and the
// fixture diff is how a prompt-surface edit becomes reviewable in a PR.
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const FIXTURES_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(FIXTURES_DIR, "..", "..", "..");
const MCP_DIR = join(REPO_ROOT, "apps", "mcp");
// node_modules is gitignored, and resolving `zod` from here lands in
// apps/mcp/node_modules — exactly what the bundled source expects.
const BUNDLE = join(MCP_DIR, "node_modules", ".eval-fixture-build.mjs");

mkdirSync(FIXTURES_DIR, { recursive: true });

await esbuild.build({
  entryPoints: [join(FIXTURES_DIR, "build-fixtures.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  alias: { "arp-domain": join(REPO_ROOT, "packages", "domain", "src", "index.ts") },
  outfile: BUNDLE,
  logLevel: "warning",
});

try {
  process.argv[2] = FIXTURES_DIR;
  await import(pathToFileURL(BUNDLE).href);
} finally {
  rmSync(BUNDLE, { force: true });
}
