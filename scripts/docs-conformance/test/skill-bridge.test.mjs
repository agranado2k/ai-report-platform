import assert from "node:assert/strict";
import { chmodSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import defaultConfig from "../config.mjs";
import { makeContext } from "../context.mjs";
import { run } from "../validators/skill-bridge.mjs";
import { cleanup, ctxFor, hasRule, makeFixture } from "./helpers.mjs";

// The signature this validator hunts: a checkout where core.symlinks=false
// materialized the .claude/skills/<name> bridge as a REGULAR FILE holding the
// link target's text. The harness that reads only that address then goes
// blind to every skill, silently.
const TARGET = "../../.agents/skills/tdd";

test("a materialized bridge — a text file holding the link target — warns, and only warns", () => {
  const ctx = ctxFor({
    ".agents/skills/tdd/SKILL.md": "# tdd\n",
    ".claude/skills/tdd": TARGET,
  });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "skill-bridge-broken"));
  assert.equal(out[0].severity, "warning");
  assert.equal(out[0].file, ".claude/skills/tdd");
  cleanup(ctx);
});

test("a healthy symlink bridge is silent", () => {
  const root = makeFixture({
    ".agents/skills/tdd/SKILL.md": "# tdd\n",
  });
  mkdirSync(join(root, ".claude/skills"), { recursive: true });
  symlinkSync("../../.agents/skills/tdd", join(root, ".claude/skills/tdd"));
  const ctx = makeContext({ repoRoot: root, config: defaultConfig });
  assert.deepEqual(run(ctx), []);
});

test("a real directory at the old address is silent — staying put is legal", () => {
  const ctx = ctxFor({
    ".claude/skills/tdd/SKILL.md": "# their own tdd, real files\n",
  });
  assert.deepEqual(run(ctx), []);
  cleanup(ctx);
});

test("an ordinary file that is not link-shaped is silent — this rule names one signature only", () => {
  const ctx = ctxFor({
    ".claude/skills/LICENSE-mattpocock-skills.md": "# a licence, many lines\nof prose\n",
  });
  assert.deepEqual(run(ctx), []);
  cleanup(ctx);
});

test("no .claude/skills directory, no finding", () => {
  const ctx = ctxFor({ "README.md": "nothing here\n" });
  assert.deepEqual(run(ctx), []);
  cleanup(ctx);
});

test("the kit's own tree is silent — its bridges are real symlinks", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const ctx = makeContext({ repoRoot: join(here, "..", "..", ".."), config: defaultConfig });
  assert.deepEqual(run(ctx), []);
});

test("the hint names the canonical path repo-relatively, and only claims it is there when it is", () => {
  const present = ctxFor({
    ".agents/skills/tdd/SKILL.md": "# tdd\n",
    ".claude/skills/tdd": TARGET,
  });
  const withSkill = run(present);
  assert.match(withSkill[0].hint, /is intact at \.agents\/skills\/tdd\./);
  cleanup(present);

  // Both copies lost: the hint must not assert a file that is not there.
  const absent = ctxFor({ ".claude/skills/tdd": TARGET });
  const withoutSkill = run(absent);
  assert.match(withoutSkill[0].hint, /should be at \.agents\/skills\/tdd\./);
  cleanup(absent);
});

// The catch arm discriminates EISDIR (the healthy shapes) from everything
// else. Without a case that actually throws something else, reverting it to a
// bare `continue` — swallowing a permission error into a silent pass — leaves
// the suite green, which is hard rule 9's definition of a claim. chmod cannot
// lock root out of a read, so the mode-dependent half is skipped there rather
// than asserted falsely.
test("an unreadable bridge entry is reported, not silently passed", {
  skip: process.getuid?.() === 0 && "chmod does not restrain root",
}, () => {
  const root = makeFixture({
    ".claude/skills/locked": "not link-shaped, and about to be unreadable\n",
  });
  const entry = join(root, ".claude/skills/locked");
  chmodSync(entry, 0o000);
  try {
    const ctx = makeContext({ repoRoot: root, config: defaultConfig });
    const out = run(ctx);
    assert.equal(out.length, 1);
    assert.ok(hasRule(out, "skill-bridge-unreadable"));
    assert.equal(out[0].severity, "warning");
    assert.equal(out[0].file, ".claude/skills/locked");
    assert.match(out[0].message, /could not be read/); // one error mode: the context reports no errno
  } finally {
    chmodSync(entry, 0o644);
    rmSync(root, { recursive: true, force: true });
  }
});

// The wrong-pass this validator gained in 0.14.0: with a skill real at BOTH
// addresses and the two bodies DIVERGED, every rule in the gate looked at the
// configured home and reported nothing about the copy the other harness runs.
test("a dangling symlink at the legacy address is silent — the gate's path rules own it", () => {
  const root = makeFixture({ ".agents/skills/tdd/SKILL.md": "# tdd\n" });
  mkdirSync(join(root, ".claude/skills"), { recursive: true });
  symlinkSync("../../.agents/skills/nowhere", join(root, ".claude/skills/nowhere"));
  const ctx = makeContext({ repoRoot: root, config: defaultConfig });
  assert.deepEqual(run(ctx), []);
});

test("a diverged real copy at the legacy address is reported, not passed over", () => {
  const ctx = ctxFor({
    ".agents/skills/tdd/SKILL.md": "# tdd\nThe canonical one.\n",
    ".claude/skills/tdd/SKILL.md": "# tdd\nA STALE fork that still runs.\n",
  });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "skill-shadowed"));
  assert.equal(out[0].file, ".claude/skills/tdd/SKILL.md");
  // An advisory: the adopt arm's collision resolution produces exactly this
  // shape on purpose, so it must not fail a build — but it must be SAID.
  assert.equal(out[0].severity, "warning");
  cleanup(ctx);
});

test("an IDENTICAL real copy at the legacy address stays silent — that is the adopt arm's sanctioned keep", () => {
  const body = "# tdd\nOne body, two addresses.\n";
  const ctx = ctxFor({
    ".agents/skills/tdd/SKILL.md": body,
    ".claude/skills/tdd/SKILL.md": body,
  });
  assert.deepEqual(run(ctx), []);
  cleanup(ctx);
});

test("one directory under two names is silent — the bodies are the same file", () => {
  const root = makeFixture({ ".agents/skills/tdd/SKILL.md": "# tdd\n" });
  mkdirSync(join(root, ".claude"), { recursive: true });
  symlinkSync("../.agents/skills", join(root, ".claude/skills"));
  const ctx = makeContext({ repoRoot: root, config: defaultConfig });
  assert.deepEqual(run(ctx), []);
});

test("a project configured ONTO the legacy home has no shadow to report — it is one address", () => {
  const cfg = {
    ...defaultConfig,
    claudeMdRefs: { ...defaultConfig.claudeMdRefs, skillsDir: ".claude/skills" },
  };
  const ctx = ctxFor({ ".claude/skills/tdd/SKILL.md": "# tdd\n" }, cfg);
  assert.deepEqual(run(ctx), []);
  cleanup(ctx);
});
