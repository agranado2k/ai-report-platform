// The skill WEB: every skill body that references a sibling skill implies that
// sibling is installed. When it is not, the project is in the half-adopted
// state a version number cannot see — an instruction chain with a dead link an
// agent only discovers by following it. That is the state a real consumer
// shipped three PRs in before a human noticed the missing feature, so this
// validator makes the state announce itself.
//
// Everything here is a WARNING, never a violation, and that is a decision,
// not a softness: declining a skill is a legal, recorded consumer state (the
// optional skill's opt-out is the precedent), and a red gate would turn every
// recorded decline into a forced adoption. The posture mirrors the tier
// resolver's unmapped warning — loud, and never fatal. `index.mjs` is the one
// place that reads `severity` and keeps warnings out of the exit code.
//
// The reference grammar is claude-md-refs' own `commandRefs`, imported rather
// than restated, so "what counts as a command reference" has exactly one
// definition. The ignore list is shared for the same reason: an agent-harness
// built-in (`/loop`) is not a skill for either validator, and one exemption
// with one recorded reason should serve both.

import { commandRefs } from "./claude-md-refs.mjs";

export const id = "skill-web";

const DEFAULT_SKILLS_DIR = ".claude/skills";

export function run(ctx) {
  const out = [];
  const cfg = ctx.config.claudeMdRefs ?? {};
  const skillsDir = cfg.skillsDir ?? DEFAULT_SKILLS_DIR;
  const ignore = new Set(cfg.ignoreCommands ?? []);

  for (const name of ctx.list(skillsDir)) {
    const file = `${skillsDir}/${name}/SKILL.md`;
    const raw = ctx.read(file);
    if (raw == null) continue; // not a skill directory (a license file, a stray)

    for (const ref of [...commandRefs(raw)].sort()) {
      if (ignore.has(`/${ref}`)) continue;
      if (ctx.exists(`${skillsDir}/${ref}/SKILL.md`)) continue;
      out.push({
        validator: id,
        severity: "warning",
        file,
        rule: "skill-web-dangling",
        message: `references \`/${ref}\` but ${skillsDir}/${ref}/SKILL.md is not installed`,
        hint: "Adopt the skill (see the skills inventory in the update recipe), record the decline in a local article, or add it to claudeMdRefs.ignoreCommands with a reason.",
      });
    }
  }
  return out;
}
