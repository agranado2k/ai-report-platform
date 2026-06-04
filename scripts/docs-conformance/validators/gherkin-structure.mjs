// Validates that each .feature file is structurally well-formed Gherkin: a
// Feature line, at least one Scenario, exactly one recognised phase tag, and
// no unknown tags. (Full semantic parsing is out of scope — see ADR-0041.)

export const id = 'gherkin-structure';

export function run(ctx) {
  const out = [];
  const allowedTags = new Set([...ctx.config.featureTags.phases, ...ctx.config.featureTags.extra]);

  for (const f of ctx.list(ctx.paths.features, '.feature')) {
    const rel = `${ctx.paths.features}/${f}`;
    const v = (rule, message, hint) => out.push({ validator: id, file: rel, rule, message, hint });
    const text = ctx.read(rel) ?? '';

    if (!/^\s*Feature:\s*\S+/m.test(text)) {
      v('no-feature', 'No "Feature:" line', 'Start the file with "Feature: <name>".');
    }
    if (!/^\s*(Scenario|Scenario Outline):\s*\S+/m.test(text)) {
      v('no-scenario', 'No Scenario', 'Add at least one "Scenario:" with Given/When/Then steps.');
    }

    const tags = text.match(/@[\w.-]+/g) ?? [];
    const phaseTags = tags.filter((t) => ctx.config.featureTags.phases.includes(t));
    if (phaseTags.length === 0) {
      v('no-phase-tag', `No phase tag (one of ${ctx.config.featureTags.phases.join(', ')})`, 'Tag the Feature with its phase, e.g. "@phase-1".');
    } else if (phaseTags.length > 1) {
      v('multiple-phase-tags', `Multiple phase tags: ${phaseTags.join(', ')}`, 'A use-case belongs to exactly one phase.');
    }
    for (const t of tags) {
      if (!allowedTags.has(t)) {
        v('unknown-tag', `Unknown tag "${t}"`, `Allowed tags: ${[...allowedTags].join(', ')}.`);
      }
    }
  }

  return out;
}
