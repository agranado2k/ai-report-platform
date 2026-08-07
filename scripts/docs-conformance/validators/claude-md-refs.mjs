// CLAUDE.md is the agent operating manual, loaded into every session. A
// command or script it references but that does not exist is worse than no
// documentation: stale standing instructions actively poison agent context
// (plan Phase 1.2 — the "process docs are executable or CI-verified" rule).
//
// Two reference kinds are checked, both extracted from backtick spans only:
//   - slash commands (`/tdd`) must resolve to .claude/skills/<name>/SKILL.md,
//     unless listed in config.claudeMdRefs.ignoreCommands (built-ins etc.);
//   - repo paths under scripts/, .husky/ or .claude/hooks/ must exist on disk.

export const id = "claude-md-refs";

const BACKTICK_SPAN = /`([^`]+)`/g;
// A slash command is a single-segment, kebab-case token: `/tdd`, `/grill-me`.
// Multi-segment spans (`/api/v1/reports`) are URLs/paths, not commands. Only
// spans that OPEN with a slash command are command-bearing — that keeps shell
// snippets (`rm -rf /tmp`) from being misread as command references — and in a
// command-bearing span every /-token is checked (`/loop /pr-iterate <PR#>`).
const COMMAND_SPAN = /^\/[a-z]/;
const COMMAND_TOKEN = /(?:^|\s)\/([a-z][a-z0-9-]*)(?=\s|$)/g;
// Checkable repo paths: anything under these roots. Extensionless names are
// legal (husky hooks are extensionless files).
const PATH_TOKEN = /^(?:scripts|\.husky|\.claude\/(?:hooks|skills))\/[\w./-]+$/;

export function run(ctx) {
  const out = [];
  const raw = ctx.read("CLAUDE.md");
  if (raw == null) return out; // fixtures that don't model CLAUDE.md
  const ignore = new Set(ctx.config.claudeMdRefs?.ignoreCommands ?? []);

  // Strip fenced code blocks first: a ``` fence would desync the inline
  // backtick pairing below, silently inverting every span in the document.
  // Fences may be indented (lists) — anchor on optional leading whitespace.
  const manual = raw.replace(/^[ \t]*```[\s\S]*?^[ \t]*```[ \t]*$/gm, "");

  const commands = new Set();
  const paths = new Set();
  for (const span of manual.matchAll(BACKTICK_SPAN)) {
    const text = span[1];
    if (PATH_TOKEN.test(text)) paths.add(text);
    if (!COMMAND_SPAN.test(text)) continue;
    for (const m of text.matchAll(COMMAND_TOKEN)) commands.add(m[1]);
  }

  for (const name of [...commands].sort()) {
    if (ignore.has(`/${name}`)) continue;
    if (!ctx.exists(`.claude/skills/${name}/SKILL.md`)) {
      out.push({
        validator: id,
        file: "CLAUDE.md",
        rule: "skill-missing",
        message: `references \`/${name}\` but .claude/skills/${name}/SKILL.md does not exist`,
        hint: "Create the skill, remove the reference, or add it to claudeMdRefs.ignoreCommands with a reason.",
      });
    }
  }

  for (const p of [...paths].sort()) {
    if (!ctx.exists(p)) {
      out.push({
        validator: id,
        file: "CLAUDE.md",
        rule: "path-missing",
        message: `references \`${p}\` but the file does not exist`,
        hint: "Create the file or remove the reference — the manual must describe reality.",
      });
    }
  }

  return out;
}
