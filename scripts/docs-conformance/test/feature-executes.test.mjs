// The guard that stops the coverage-theatre regressing.
//
// For months the corpus held 33 `.feature` files of which exactly ONE was
// opted into `playwright.config.ts`'s `features` array — the only thing that
// makes a feature actually run. `feature-presence` was green throughout,
// because a bijection between a catalog and a directory says nothing about
// execution. These are the assertions that close that gap.
import assert from "node:assert/strict";
import { test } from "node:test";
import defaultConfig from "../config.mjs";
import * as featureExecutes from "../validators/feature-executes.mjs";
import { cleanup, ctxFor, hasRule } from "./helpers.mjs";

const fullConfig = {
  ...defaultConfig,
  features: { "demo-use-case": { title: "Demo", phase: "@phase-1", status: "full" } },
};
const wipConfig = {
  ...defaultConfig,
  features: { "demo-use-case": { title: "Demo", phase: "@phase-1", status: "wip" } },
};

/** A playwright.config.ts whose `features` array lists exactly `slugs`. */
function pwConfig(slugs) {
  const listed = slugs.map((s) => `    "tests/e2e/features/${s}.feature",`).join("\n");
  return `import { defineBddConfig } from "playwright-bdd";
const testDir = defineBddConfig({
  features: [
    "tests/e2e/smoke/**/*.feature",
${listed}
  ],
  steps: ["tests/e2e/features/**/*.steps.ts"],
});
`;
}

test("a `full` use-case that is opted in and has steps produces no violations", () => {
  const ctx = ctxFor(
    {
      "playwright.config.ts": pwConfig(["demo-use-case"]),
      "tests/e2e/features/demo-use-case.feature": "@phase-1\nFeature: Demo\n",
      "tests/e2e/features/demo-use-case.steps.ts": "// steps",
    },
    fullConfig,
  );
  assert.deepEqual(featureExecutes.run(ctx), []);
  cleanup(ctx);
});

test("a `full` use-case missing from playwright.config.ts is flagged", () => {
  // THE EXACT SHAPE THE CORPUS WAS IN: catalogued as covered, never executed.
  const ctx = ctxFor(
    {
      "playwright.config.ts": pwConfig([]),
      "tests/e2e/features/demo-use-case.feature": "@phase-1\nFeature: Demo\n",
      "tests/e2e/features/demo-use-case.steps.ts": "// steps",
    },
    fullConfig,
  );
  assert.ok(hasRule(featureExecutes.run(ctx), "feature-not-executed"));
  cleanup(ctx);
});

test("a `full` use-case with no step definitions beside it is flagged", () => {
  const ctx = ctxFor(
    {
      "playwright.config.ts": pwConfig(["demo-use-case"]),
      "tests/e2e/features/demo-use-case.feature": "@phase-1\nFeature: Demo\n",
    },
    fullConfig,
  );
  assert.ok(hasRule(featureExecutes.run(ctx), "feature-without-steps"));
  cleanup(ctx);
});

test("a `full` use-case still carrying @wip is flagged — the grep would exclude it", () => {
  const ctx = ctxFor(
    {
      "playwright.config.ts": pwConfig(["demo-use-case"]),
      "tests/e2e/features/demo-use-case.feature": "@phase-1 @wip\nFeature: Demo\n",
      "tests/e2e/features/demo-use-case.steps.ts": "// steps",
    },
    fullConfig,
  );
  assert.ok(hasRule(featureExecutes.run(ctx), "executed-feature-is-wip"));
  cleanup(ctx);
});

test("a `wip` use-case opted into the run is flagged — the status is then a lie", () => {
  const ctx = ctxFor(
    {
      "playwright.config.ts": pwConfig(["demo-use-case"]),
      "tests/e2e/features/demo-use-case.feature": "@phase-1 @wip\nFeature: Demo\n",
    },
    wipConfig,
  );
  assert.ok(hasRule(featureExecutes.run(ctx), "wip-feature-executed"));
  cleanup(ctx);
});

test("a `wip` use-case left out of the run produces no violations", () => {
  const ctx = ctxFor(
    {
      "playwright.config.ts": pwConfig([]),
      "tests/e2e/features/demo-use-case.feature": "@phase-1 @wip\nFeature: Demo\n",
    },
    wipConfig,
  );
  assert.deepEqual(featureExecutes.run(ctx), []);
  cleanup(ctx);
});

test("an unparseable playwright.config.ts fails LOUDLY rather than passing vacuously", () => {
  // A guard that silently succeeds when it cannot find what it guards is worse
  // than no guard — it is the same class of failure as the corpus itself.
  const ctx = ctxFor(
    {
      "playwright.config.ts": "export default {};",
      "tests/e2e/features/demo-use-case.feature": "@phase-1\nFeature: Demo\n",
      "tests/e2e/features/demo-use-case.steps.ts": "// steps",
    },
    fullConfig,
  );
  assert.ok(hasRule(featureExecutes.run(ctx), "features-array-unreadable"));
  cleanup(ctx);
});

test("a missing playwright.config.ts is flagged too", () => {
  const ctx = ctxFor({}, fullConfig);
  assert.ok(hasRule(featureExecutes.run(ctx), "features-array-unreadable"));
  cleanup(ctx);
});
