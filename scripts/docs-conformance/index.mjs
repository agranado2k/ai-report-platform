#!/usr/bin/env node
// docs-conformance entry point. Runs every validator against the repo and
// exits non-zero on any violation. Invoked by `pnpm docs:check` and by the
// docs-conformance CI workflow. Optional arg: a repo root (defaults to the
// repo this script lives in).

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import config from "./config.mjs";
import { makeContext } from "./context.mjs";
import { runAll } from "./runner.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = process.argv[2] ?? join(here, "..", "..");

const ctx = makeContext({ repoRoot, config });
const violations = runAll(ctx);

if (violations.length === 0) {
  console.log("✓ docs conformance: all checks passed");
  process.exit(0);
}

// Group by validator for a readable report.
const byValidator = new Map();
for (const v of violations) {
  if (!byValidator.has(v.validator)) byValidator.set(v.validator, []);
  byValidator.get(v.validator).push(v);
}

console.error("✗ docs conformance: violations found\n");
for (const [validator, items] of byValidator) {
  console.error(`  [${validator}] (${items.length})`);
  for (const v of items) {
    console.error(`    ✗ ${v.file} — ${v.message}`);
    console.error(`      ↳ ${v.hint}`);
  }
  console.error("");
}
console.error(`${violations.length} violation(s) across ${byValidator.size} validator(s).`);
process.exit(1);
