// Enforces that a catalogued use-case marked `status: 'full'` actually RUNS.
//
// WHY THIS EXISTS. `feature-presence` enforces a bijection between the catalog
// and the files on disk, and it was green for months while the corpus held 33
// `.feature` files of which exactly ONE was opted into `playwright.config.ts`'s
// `features` array. A bijection between a list and a directory says nothing
// about execution: a feature not named in that array does not run, no matter
// how good it reads, and a `.feature` file describing behaviour nobody tests is
// worse than no file, because it is exactly what stops the next person writing
// the test.
//
// So `status: 'full'` now means one thing only — "this executes in CI" — and
// three mechanical facts have to hold for it:
//
//   1. the feature is listed in playwright.config.ts's `features` array;
//   2. a `<slug>.steps.ts` sits beside it. This is the cheap file-level half;
//      the authoritative half is `pnpm e2e:gen` (`bddgen`), which generates a
//      spec per opted-in feature and ERRORS on any undefined step, and which
//      `.github/workflows/unit.yml` runs on every PR — in the fast gate,
//      because it needs nothing but the repo;
//   3. it does not carry `@wip`, which playwright.config.ts's `grepInvert`
//      would silently exclude, putting it back to "listed but never run".
//
// And the converse: a `'wip'` use-case must NOT be opted in, or its status is
// simply false.
//
// PARSED, NOT IMPORTED. Reading playwright.config.ts as text avoids executing
// a Playwright config (which pulls in the whole test runner and reads env) from
// inside a docs linter. The parse is deliberately strict: if the `features`
// array cannot be found, that is a violation rather than a silent pass — a
// guard that succeeds when it cannot find what it guards repeats the very
// failure it was written for.

export const id = "feature-executes";

const CONFIG_PATH = "playwright.config.ts";

/**
 * The tags a `.feature` file actually CARRIES, as opposed to the ones it talks
 * about. Only whole lines consisting of nothing but tags count — a `#` comment
 * explaining that a feature "was a step-less @wip skeleton" is prose, and a
 * scan that treats it as a tag would flag the file for describing its own
 * history.
 */
function declaredTags(text) {
  const tags = new Set();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!/^@[\w.-]+(\s+@[\w.-]+)*$/.test(trimmed)) continue;
    for (const tag of trimmed.split(/\s+/)) tags.add(tag);
  }
  return tags;
}

/**
 * The string literals inside `defineBddConfig({ features: [ … ] })`.
 * Returns null when the array cannot be located.
 */
function readFeaturesArray(ctx) {
  const source = ctx.read(CONFIG_PATH);
  if (source === null) return null;
  const match = source.match(/features\s*:\s*\[([\s\S]*?)\]/);
  if (!match) return null;
  const entries = [...(match[1] ?? "").matchAll(/["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
  return entries.length > 0 ? entries : null;
}

export function run(ctx) {
  const out = [];
  const catalog = ctx.config.features;
  const v = (file, rule, message, hint) => out.push({ validator: id, file, rule, message, hint });

  const listed = readFeaturesArray(ctx);
  if (listed === null) {
    v(
      CONFIG_PATH,
      "features-array-unreadable",
      "Could not read a non-empty `features: [...]` array from playwright.config.ts",
      "This validator is the only thing standing between the catalog and coverage theatre; it must not pass when it cannot see the array. Restore the array, or update the parser in scripts/docs-conformance/validators/feature-executes.mjs.",
    );
    return out;
  }

  /** Feature paths explicitly listed (globs are for tests/e2e/smoke only). */
  const listedFeatures = new Set(listed);

  for (const [slug, entry] of Object.entries(catalog)) {
    const featurePath = `${ctx.paths.features}/${slug}.feature`;
    const stepsPath = `${ctx.paths.features}/${slug}.steps.ts`;
    const isListed = listedFeatures.has(featurePath);
    const text = ctx.read(featurePath) ?? "";

    if (entry.status === "full") {
      if (!isListed) {
        v(
          featurePath,
          "feature-not-executed",
          `Use-case "${slug}" is catalogued status: "full" but is not in playwright.config.ts's \`features\` array`,
          `A feature that is not listed there does not run. Add "${featurePath}" to the array, or change the catalog entry to status: "wip" and record it as a known gap in tests/e2e/README.md.`,
        );
      }
      if (!ctx.exists(stepsPath)) {
        v(
          featurePath,
          "feature-without-steps",
          `Use-case "${slug}" is catalogued status: "full" but has no ${slug}.steps.ts beside it`,
          "A feature with no step definitions cannot execute — playwright-bdd errors at collection. Write the steps, or mark the use-case as a known gap.",
        );
      }
      if (declaredTags(text).has("@wip")) {
        v(
          featurePath,
          "executed-feature-is-wip",
          `Use-case "${slug}" is catalogued status: "full" but the feature file still carries @wip`,
          "playwright.config.ts's `grepInvert` excludes @wip, so this would be listed-but-never-run — the exact state this validator exists to prevent. Drop the tag.",
        );
      }
    } else if (isListed) {
      v(
        featurePath,
        "wip-feature-executed",
        `Use-case "${slug}" is catalogued status: "wip" but IS opted into playwright.config.ts's \`features\` array`,
        'A running feature is not work-in-progress. Promote the catalog entry to status: "full", or remove it from the array.',
      );
    }
  }

  // A listed product feature that nothing catalogues would run without ever
  // having been declared as coverage. (`feature-presence` catches the file-level
  // orphan; this catches the execution-level one.)
  for (const path of listedFeatures) {
    if (!path.startsWith(`${ctx.paths.features}/`)) continue;
    const slug = path.slice(`${ctx.paths.features}/`.length).replace(/\.feature$/, "");
    if (!catalog[slug]) {
      v(
        path,
        "executed-feature-uncatalogued",
        `playwright.config.ts runs "${slug}.feature", which is not in the use-case catalog`,
        'Add it to config.features with status: "full", or stop running it.',
      );
    }
  }

  return out;
}
