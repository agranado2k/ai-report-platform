// Validates that every canonical domain event is referenced in both language
// sources of truth — docs/events.md and docs/domain-glossary.md — so the event
// contract has exactly one spelling everywhere it is named.

export const id = 'event-names';

export function run(ctx) {
  const out = [];
  const targets = [ctx.paths.events, ctx.paths.glossary];
  const texts = Object.fromEntries(targets.map((t) => [t, ctx.read(t) ?? '']));

  for (const event of ctx.config.events) {
    for (const t of targets) {
      if (!texts[t].includes(event)) {
        out.push({
          validator: id,
          file: t,
          rule: 'event-missing',
          message: `Canonical event "${event}" is not referenced in ${t}`,
          hint: 'Every canonical domain event must appear in events.md and the glossary.',
        });
      }
    }
  }

  return out;
}
