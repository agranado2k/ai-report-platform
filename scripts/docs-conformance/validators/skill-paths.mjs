// Skill INTERIORS join the gate: every repo-path a skill body names is a file
// an agent will be told to open, so a dead one is a standing instruction into
// a wall. The manual layer has been held to this since the gate existed; this
// validator extends the same rule to `SKILL.md` and the sidecar markdown
// beside it.
//
// Findings here are WARNINGS, the same posture as the skill-web advisory —
// and that was a discovery, not the plan. The PRD ordered violations ("a dead
// path in an installed skill has no legitimate reading"), and implementation
// promptly found the legitimate reading: VERSION SKEW. Part 2 of the update
// recipe is manual and per-category, so a consumer mid-update — or one who
// took skills without the article a later release adds — holds skills that
// reference files that have not arrived yet, and the recipe itself requires a
// GREEN gate before an update begins. The kit's own recipe demo models
// exactly these states. A red gate would make the sanctioned starting state
// of every update illegal; a warning names the skew and lets the update
// proceed to fix it.
//
// Two accommodations, both policy rather than special cases:
//
//   - THE TEMPLATE FALLBACK. Skills ship unstamped and must read correctly on
//     both sides of bootstrap: `constitution/local-workflow.md` is a real file
//     in a consumer and only a `.template` in the kit. A token resolves if the
//     file exists OR its `.template` source does — one rule, no kit-only carve-out.
//   - EXEMPTIONS in the consumer-owned config, two shapes, each entry with a
//     reason: `skillPaths.exemptFiles` skips a whole file (for upstream-verbatim
//     documents this repo may not edit), and `skillPaths.exemptTokens` skips an
//     exact path that is legitimately absent until something creates it (a
//     report directory the skill's first run makes; a workflow bootstrap
//     installs from the templates tree).
//
// The grammar is claude-md-refs' own, imported: pathTokenRe over the SAME
// pathRoots the manual validator reads, and the same code-span/fence rules —
// one definition of "what is a path reference", now three consumers.

import { LEGACY_SKILLS_DIR, pathRefs, pathTokenRe, skillHomes } from "./claude-md-refs.mjs";

export const id = "skill-paths";

const DEFAULT_SKILLS_DIR = ".agents/skills";

export function run(ctx) {
  const out = [];
  const refsCfg = ctx.config.claudeMdRefs ?? {};
  const cfg = ctx.config.skillPaths ?? {};
  const skillsDir = refsCfg.skillsDir ?? DEFAULT_SKILLS_DIR;
  const pathRe = pathTokenRe(refsCfg.pathRoots ?? []);
  const exempt = new Set(cfg.exemptFiles ?? []);
  const exemptTokens = new Set(cfg.exemptTokens ?? []);

  // Both homes are ENUMERATED, not just resolved — same reasoning as
  // skill-web's: a tree whose skills stayed at the legacy address is
  // sanctioned, and scanning only the configured home would drop its body
  // coverage to zero in silence. De-duplicated by skill name; the configured
  // home wins when a skill sits at both.
  const seen = new Set();
  const homes = skillHomes(skillsDir);
  for (const dir of homes) {
    for (const name of ctx.list(dir)) {
      if (seen.has(name)) continue;
      if (!ctx.exists(`${dir}/${name}/SKILL.md`)) continue; // not a skill dir
      seen.add(name);
      for (const md of ctx.list(`${dir}/${name}`, ".md")) {
        const file = `${dir}/${name}/${md}`;
        if (exempt.has(file)) continue;
        const raw = ctx.read(file);
        if (raw == null) continue;

        for (const token of [...pathRefs(raw, pathRe)].sort()) {
          if (exemptTokens.has(token)) continue;
          if (ctx.exists(token)) continue;
          if (ctx.exists(`${token}.template`)) continue;
          out.push({
            validator: id,
            severity: "warning",
            file,
            rule: "skill-path-missing",
            message: `references \`${token}\` but neither it nor \`${token}.template\` exists`,
            hint: "Fix the reference, restore the file, or finish the update that delivers it — an agent obeying this skill will be pointed at it. An upstream-verbatim file goes in skillPaths.exemptFiles; a path that exists only after something creates it goes in skillPaths.exemptTokens. Reasons on every entry.",
          });
        }
      }
    }
  }
  return out;
}
