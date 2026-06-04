// Enforces a bijection between the use-case catalog (config.features) and the
// .feature files on disk: every catalogued use-case has a file, and every file
// is catalogued. Keeps the spec's use-case list and the BDD corpus in lockstep.

export const id = 'feature-presence';

export function run(ctx) {
  const out = [];
  const catalog = ctx.config.features;
  const present = new Set(
    ctx.list(ctx.paths.features, '.feature').map((f) => f.replace(/\.feature$/, '')),
  );

  for (const slug of Object.keys(catalog)) {
    if (!present.has(slug)) {
      out.push({
        validator: id,
        file: `${ctx.paths.features}/${slug}.feature`,
        rule: 'feature-missing',
        message: `Catalogued use-case "${slug}" has no .feature file`,
        hint: 'Author the feature file, or remove it from the catalog in config.mjs.',
      });
    }
  }
  for (const slug of present) {
    if (!catalog[slug]) {
      out.push({
        validator: id,
        file: `${ctx.paths.features}/${slug}.feature`,
        rule: 'feature-orphan',
        message: `Feature file "${slug}.feature" is not in the use-case catalog`,
        hint: 'Add it to config.features, or rename the file to a catalogued slug.',
      });
    }
  }

  return out;
}
