// CLAUDE.md is the agent operating manual, loaded into every session. A
// command or script it references but that does not exist is worse than no
// documentation: stale standing instructions actively poison agent context
// (plan Phase 1.2 — the "process docs are executable or CI-verified" rule).
//
// Three reference kinds are checked. Two are extracted from backtick spans:
//   - slash commands (`/tdd`) must resolve to .claude/skills/<name>/SKILL.md,
//     unless listed in config.claudeMdRefs.ignoreCommands (built-ins etc.);
//   - repo paths under the checked roots below must exist on disk.
// The third is reachability: every article must be referenced from the root.
//
// The manual is LAYERED (ADR-0082): the root is small and high-precedence, and
// delegates its elaboration to articles under .claude/constitution/. Those
// articles are standing instructions too — an agent loads one on demand and
// obeys it — so they get exactly the same checks as the root, and the root's
// references TO them are existence-checked like any other repo path. Checking
// only the root would leave the layer the restructure moved most of the prose
// into completely unguarded.
//
// Reachability closes the other half of that hole. Progressive disclosure means
// an article is loaded only because the root pointed at it, so an article the
// root never names is dead text: it binds nobody, and it drifts unnoticed
// because nothing reads it. One home per rule requires exactly one door in.

export const id = "claude-md-refs";

const ROOT_MANUAL = "CLAUDE.md";
const CONSTITUTION_DIR = ".claude/constitution";

const BACKTICK_SPAN = /`([^`]+)`/g;
// A slash command is a single-segment, kebab-case token: `/tdd`, `/grill-me`.
// Multi-segment spans (`/api/v1/reports`) are URLs/paths, not commands. Only
// spans that OPEN with a slash command are command-bearing — that keeps shell
// snippets (`rm -rf /tmp`) from being misread as command references — and in a
// command-bearing span every /-token is checked (`/loop /pr-iterate <PR#>`).
const COMMAND_SPAN = /^\/[a-z]/;
const COMMAND_TOKEN = /(?:^|\s)\/([a-z][a-z0-9-]*)(?=\s|$)/g;
// Checkable repo paths: anything under these roots. Extensionless names are
// legal (husky hooks are extensionless files). The roots span every tree the
// manual layer actually points into — agent surfaces, docs, code and infra —
// so a nested-manual reference like `apps/mcp/CLAUDE.md` is checked too. Roots
// NOT listed here (node_modules/, worktree/, generated output) are deliberately
// out of scope: they are not part of the repo's reviewed surface.
const PATH_TOKEN =
  /^(?:scripts|\.husky|\.github|docs|apps|packages|infra|\.claude\/(?:hooks|skills|constitution))\/[\w./-]+$/;

export function run(ctx) {
  const articles = ctx.list(CONSTITUTION_DIR, ".md").map((name) => `${CONSTITUTION_DIR}/${name}`);

  // The root first, then each article — so a run's violations read top-down
  // through the layers the way an agent loads them.
  const out = [ROOT_MANUAL, ...articles].flatMap((file) => checkOne(ctx, file));

  // Reachability is only a question when there IS a root to be reached from —
  // fixtures that model articles alone stay silent, as they do for the root.
  const root = ctx.read(ROOT_MANUAL);
  if (root == null) return out;
  const referenced = extractRefs(root).paths;
  for (const article of articles) {
    if (referenced.has(article)) continue;
    out.push({
      validator: id,
      file: article,
      rule: "article-unreferenced",
      message: `is not referenced from ${ROOT_MANUAL} — no agent will ever be pointed at it`,
      hint: `Add a pointer to it in ${ROOT_MANUAL}'s article layer, or delete the article — an unreachable standing instruction binds nobody and drifts unnoticed.`,
    });
  }

  return out;
}

/**
 * Extract the executable references from one manual's prose.
 *
 * Fenced code blocks are stripped first: a fence's own markers (``` = three
 * backticks) would desync the inline backtick pairing below, silently
 * inverting every span in the rest of the document. `~~~` fences get the same
 * treatment — a manual reaches for `~~~` precisely to show a ``` fence
 * verbatim, which is the case that leaves stray backticks behind. Fences may
 * be indented (lists), so anchor on optional leading whitespace.
 */
function extractRefs(raw) {
  const manual = raw.replace(/^[ \t]*(```|~~~)[\s\S]*?^[ \t]*\1[ \t]*$/gm, "");

  const commands = new Set();
  const paths = new Set();
  for (const span of manual.matchAll(BACKTICK_SPAN)) {
    const text = span[1];
    if (PATH_TOKEN.test(text)) paths.add(text);
    if (!COMMAND_SPAN.test(text)) continue;
    for (const m of text.matchAll(COMMAND_TOKEN)) commands.add(m[1]);
  }
  return { commands, paths };
}

/** Check one manual file (the root, or one constitution article). */
function checkOne(ctx, file) {
  const out = [];
  const raw = ctx.read(file);
  if (raw == null) return out; // fixtures that don't model CLAUDE.md
  const ignore = new Set(ctx.config.claudeMdRefs?.ignoreCommands ?? []);

  const { commands, paths } = extractRefs(raw);

  for (const name of [...commands].sort()) {
    if (ignore.has(`/${name}`)) continue;
    if (!ctx.exists(`.claude/skills/${name}/SKILL.md`)) {
      out.push({
        validator: id,
        file,
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
        file,
        rule: "path-missing",
        message: `references \`${p}\` but the file does not exist`,
        hint: "Create the file or remove the reference — the manual must describe reality.",
      });
    }
  }

  return out;
}
