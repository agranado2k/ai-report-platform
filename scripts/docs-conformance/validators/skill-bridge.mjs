// The symlink bridge's tripwire. Since 0.14.0 the skills live canonically at
// .agents/skills/ and .claude/skills/<name> is a committed relative symlink —
// the per-skill-entry shape the one harness that reads only that address
// documents. A checkout with core.symlinks=false (Git for Windows outside
// developer mode) MATERIALIZES each symlink as a regular text file holding
// the link target, and that harness then goes blind to every skill with no
// error anywhere. This validator names that exact signature.
//
// It also names the SHADOW: a skill that is a real directory at both
// addresses with two different bodies. Which one runs then depends on which
// address the reader's harness knows about, and before this rule existed
// every validator in the gate looked at the configured home alone and said
// nothing about the other copy.
//
// Findings are WARNINGS, for two different reasons. For the materialized
// bridge, the tree is not wrong, the CHECKOUT is, and the fix is per-clone
// (`git config core.symlinks true` and re-checkout, or work from WSL — the
// kit's gates already require POSIX sh); a broken checkout must still be
// able to run the gate that diagnoses it, so promotion has no path there by
// design. For the shadow, the state can be entirely deliberate: it is the
// exact shape bootstrap's adopt arm leaves behind when a consumer's own
// skill collides with the kit's and they keep theirs at the old address. A
// build may not fail for a layout the kit itself hands you — but it should
// not be the only thing that never mentions it either.
//
// A real directory at the old address with NO canonical twin stays silent: a
// pre-0.14.0 project staying put is a legal permanent state, and identical
// twins are silent too, which covers one directory reached by two names
// without needing to stat anything. This rule names failure shapes, not a
// layout police.

import { DEFAULT_SKILLS_DIR, LEGACY_SKILLS_DIR } from "./claude-md-refs.mjs";

export const id = "skill-bridge";

// What git writes into a materialized symlink: the target string, alone.
// Ours are relative and point into the canonical home.
const MATERIALIZED_RE = /^(\.\.\/)+\.agents\/skills\/[A-Za-z0-9._-]+\s*$/;

export function run(ctx) {
  const out = [];
  for (const name of ctx.list(LEGACY_SKILLS_DIR)) {
    const entry = `${LEGACY_SKILLS_DIR}/${name}`;
    // What is at the address decides the shape. A directory (real, or a
    // symlink resolving to one) is the healthy layout and is checked only for
    // a diverged twin; a file is either the materialized signature or a
    // stray; nothing usable (a dangling symlink) is the gate's path rules'
    // business, not this rule's.
    const kind = ctx.kind(entry);
    if (kind === "directory") {
      // A real directory here is USUALLY the sanctioned staying-put layout,
      // and silent. It is not silent when a canonical twin exists and the
      // two bodies DIFFER: that is two different skills wearing one name,
      // and which one runs depends on which address the reader's harness
      // happens to know about. The gate reads the configured home and would
      // report nothing about the other copy — the wrong-pass this rule
      // exists to end. Identical bodies stay silent, which also covers the
      // two shapes that are one directory under two names (an alias, or a
      // bridge) without needing to stat.
      const skillsDir = ctx.config?.claudeMdRefs?.skillsDir ?? DEFAULT_SKILLS_DIR;
      if (skillsDir !== LEGACY_SKILLS_DIR) {
        const mine = ctx.read(`${entry}/SKILL.md`);
        const theirs = ctx.read(`${skillsDir}/${name}/SKILL.md`);
        if (mine != null && theirs != null && mine !== theirs) {
          out.push({
            validator: id,
            // A WARNING, not a violation, and the adopt arm is the reason:
            // when a consumer's own skill collides with the kit's, the
            // sanctioned resolution is precisely this shape — theirs stands
            // in at the name, the kit's sits canonically beneath it. That
            // is a deliberate state, so it may not fail a build; but it is
            // still two bodies under one name, and it used to be reported
            // by nothing at all.
            severity: "warning",
            file: `${entry}/SKILL.md`,
            rule: "skill-shadowed",
            message: `differs from ${skillsDir}/${name}/SKILL.md — the same skill name holds two different bodies, and which one runs depends on which address the agent reads`,
            hint: `If this is deliberate (your own skill standing in at the kit's name) nothing is broken and this line is simply the record of it. Otherwise: delete the copy you do not want, rename one, or make ${entry} a symlink to ../../${skillsDir}/${name}. Identical copies are silent, so this fires only on a real divergence.`,
          });
        }
      }
      continue;
    }
    if (kind !== "file") continue; // dangling symlink — the gate's path rules own that
    if (!ctx.readable(entry)) {
      // A file that is there and cannot be read — permissions, say — must
      // not be swallowed into a silent pass: report it rather than pretend
      // the entry was fine. Asked before reading, because a read of it would
      // throw, and this rule owns the verdict on its own entries.
      out.push({
        validator: id,
        severity: "warning",
        file: entry,
        rule: "skill-bridge-unreadable",
        message: "could not be read — the bridge cannot be checked here",
        hint: "Fix the permissions or remove the entry; an unreadable bridge slot hides whether the harness can see this skill at all.",
      });
      continue;
    }
    const raw = ctx.read(entry);
    if (raw == null) continue; // gone between stat and read — nothing to judge
    if (!MATERIALIZED_RE.test(raw)) continue; // ordinary file (a licence, a stray)
    // The materialized text is relative to the LINK's directory; the hint
    // below names a repo-relative path, so strip the climb. Never assert the
    // canonical copy is there without looking — on a tree that lost both, a
    // confident "it is intact at" would send the reader hunting for a file
    // that does not exist.
    const canonical = raw.trim().replace(/^(\.\.\/)+/, "");
    out.push({
      validator: id,
      severity: "warning",
      file: entry,
      rule: "skill-bridge-broken",
      message:
        "is a regular file holding a symlink target — this checkout materialized the skill bridge, and the harness that reads only this address sees no skills",
      hint: `Re-checkout with symlinks enabled (\`git config core.symlinks true\`, then restore the files) or work from an environment that supports them (the kit's gates already require POSIX sh — WSL on Windows). The skill itself ${
        ctx.exists(canonical) ? "is intact at" : "should be at"
      } ${canonical}.`,
    });
  }
  return out;
}
