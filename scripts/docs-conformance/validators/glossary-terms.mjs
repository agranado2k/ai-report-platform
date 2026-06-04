// Enforces ubiquitous-language spelling across docs/*.md and the ADRs: flags
// banned aliases (e.g. bare "Version" instead of "ReportVersion"). Lines that
// document the ban itself ("_Avoid_" / "Avoid:") are skipped, as are files in
// config.glossary.scanExclude (the diary quotes superseded terms by design).

export const id = 'glossary-terms';

export function run(ctx) {
  const out = [];
  const exclude = new Set(ctx.config.glossary.scanExclude ?? []);

  const docFiles = ctx.list(ctx.paths.docs, '.md').map((f) => `${ctx.paths.docs}/${f}`);
  const adrFiles = ctx.list(ctx.paths.adrDir, '.md').map((f) => `${ctx.paths.adrDir}/${f}`);
  const files = [...docFiles, ...adrFiles].filter((rel) => !exclude.has(rel));

  for (const rel of files) {
    const text = ctx.read(rel);
    if (!text) continue;
    text.split('\n').forEach((line, i) => {
      if (/_avoid_|avoid:/i.test(line)) return;
      for (const ban of ctx.config.glossary.bannedAliases) {
        if (ban.re.test(line)) {
          out.push({
            validator: id,
            file: rel,
            rule: 'banned-alias',
            message: `Line ${i + 1}: banned term "${ban.term}" — use "${ban.canonical}"`,
            hint: ban.hint,
          });
        }
      }
    });
  }

  return out;
}
