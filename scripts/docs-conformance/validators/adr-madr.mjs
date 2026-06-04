// Validates that every ADR file follows the MADR template: a recognised
// `**Status**`, the required section headings, and a conformant filename.

export const id = 'adr-madr';

const FILENAME_RE = /^\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

export function run(ctx) {
  const out = [];
  const files = ctx.list(ctx.paths.adrDir, '.md').filter((f) => f !== 'INDEX.md');

  for (const f of files) {
    const rel = `${ctx.paths.adrDir}/${f}`;
    const v = (rule, message, hint) => out.push({ validator: id, file: rel, rule, message, hint });

    if (!FILENAME_RE.test(f)) {
      v('adr-filename', `Filename "${f}" must be NNNN-kebab-title.md`, 'Four-digit zero-padded number, then a kebab-case title.');
    }

    const text = ctx.read(rel) ?? '';

    for (const section of ctx.config.adr.requiredSections) {
      if (!text.toLowerCase().includes(section.toLowerCase())) {
        v('adr-section', `Missing required section "${section}"`, `Add a "## ${section}" heading (MADR template).`);
      }
    }

    const statusMatch = text.match(/\*\*Status\*\*\s*:?\s*(.+)/i);
    if (!statusMatch) {
      v('adr-status-missing', 'No **Status** field', 'Add "- **Status**: Accepted" near the top.');
    } else {
      const status = statusMatch[1].trim();
      const ok = ctx.config.adr.allowedStatuses.some((s) => status.toLowerCase().startsWith(s.toLowerCase()));
      if (!ok) {
        v('adr-status-value', `Status "${status}" not in allowed vocabulary`, `Use one of: ${ctx.config.adr.allowedStatuses.join(', ')}.`);
      }
    }
  }

  return out;
}
