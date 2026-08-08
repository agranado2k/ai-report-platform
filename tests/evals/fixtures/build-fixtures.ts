// Entry point for `sync-fixtures.mjs`. Writes the two generated fixtures the
// promptfoo suite feeds the model:
//
//   instructions.txt — the ADR-0072 Layer-0 server `instructions` string, used
//                      verbatim as the system prompt.
//   mcp-tools.json   — every registered tool as an Anthropic tool definition,
//                      so the model under eval sees the SHIPPED descriptions.
//
// Both are checked in (the eval job must not need a build step) and pinned by
// `golden-set.test.ts`, so an edit to `instructions.ts`/`tools.ts` that skips
// the regeneration fails the fast gate.
//
// The output directory arrives as argv[2] because this module is bundled and
// run from outside the repo's source tree (see `sync-fixtures.mjs`), so
// `import.meta.url` would point at the bundle, not at `tests/evals/fixtures`.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { INSTRUCTIONS, toolsForProvider } from "../surface";

const outDir = process.argv[2];
if (!outDir) {
  throw new Error("usage: build-fixtures <output-directory>");
}

const tools = toolsForProvider();
writeFileSync(join(outDir, "instructions.txt"), `${INSTRUCTIONS}\n`, "utf8");
writeFileSync(join(outDir, "mcp-tools.json"), `${JSON.stringify(tools, null, 2)}\n`, "utf8");

console.log(`✓ regenerated tests/evals/fixtures from apps/mcp/src (${tools.length} tools)`);
