// Self-tests for THIS REPO's capability-tier mapping (scripts/agents.config.sh),
// resolved through the shared resolver (scripts/agents.lib.sh). ADR-0084.
//
// The resolver itself is shared-layer mechanism; what this pins is the LOCAL
// policy decision that the kit deliberately leaves open: that this repo maps
// every tier to a model, and that the cheap tier and the adversarial tier do
// not collapse into the same one. Per shared-invariant §8 the mapping is a
// mechanism, not a prose claim — so if a tier is ever emptied, or `mechanical`
// is ever pointed at the same model as `reviewer`, a test fails here rather
// than the seam silently costing process and saving nothing.
//
// Runs the REAL resolver as an agent following a SKILL.md would
// (`sh scripts/agents.lib.sh <tier>` from the repo root), so it exercises the
// exact resolution path, not a fake. Dependency-free node:test tier, same as
// the sibling scripts/test/*.test.mjs files (`pnpm test:scripts`).

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../../..");
const RESOLVER = resolve(REPO_ROOT, "scripts/agents.lib.sh");
const TIERS = ["planner", "implementer", "mechanical", "reviewer"];

/** Resolve a tier the way a SKILL.md does: from the repo root, capturing only
 *  stdout (the resolver prints the model to stdout, diagnostics to stderr). */
function resolveTier(tier, domain) {
  const args = domain ? [RESOLVER, tier, domain] : [RESOLVER, tier];
  return execFileSync("sh", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

for (const tier of TIERS) {
  test(`tier '${tier}' resolves to a mapped model`, () => {
    const model = resolveTier(tier);
    assert.notEqual(
      model,
      "",
      `tier '${tier}' resolved to nothing — every tier must be mapped in scripts/agents.config.sh (ADR-0084); an unmapped tier here is a dropped mapping, not a working default`,
    );
  });
}

test("the cost seam holds: mechanical is not the reviewer model", () => {
  // The whole point of the mechanical tier is that it is cheaper than the
  // adversarial one. If these ever collapse to the same model the seam costs
  // process and saves nothing — that should have to break a test first.
  assert.notEqual(
    resolveTier("mechanical"),
    resolveTier("reviewer"),
    "mechanical and reviewer resolved to the same model — the cost seam has collapsed (ADR-0084)",
  );
});

test("an unmapped domain falls back to its tier, silently", () => {
  // The domain axis is optional and open (ADR-0084): a domain this repo has no
  // opinion about must resolve to the plain tier, not error.
  assert.equal(
    resolveTier("implementer", "no-such-domain"),
    resolveTier("implementer"),
    "an unmapped domain must fall back to the plain tier",
  );
});

test("an unknown tier is a usage error (the vocabulary is closed)", () => {
  assert.throws(
    () => execFileSync("sh", [RESOLVER, "implementor"], { cwd: REPO_ROOT, encoding: "utf8" }),
    (err) => err.status === 2,
    "a typo'd tier must exit 2, not silently resolve",
  );
});
