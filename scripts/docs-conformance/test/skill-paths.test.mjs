import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import defaultConfig from "../config.mjs";
import { makeContext } from "../context.mjs";
import { run } from "../validators/skill-paths.mjs";
import { cleanup, ctxFor, hasRule } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// Skills are executable prose: a path a skill names is a file an agent will be
// told to open. The manual layer already fails the gate on a dead path; these
// fixtures hold skill INTERIORS — SKILL.md and its sidecars — to the same
// standard, with the one twist the manual never needs: the template fallback,
// because a skill saying `constitution/local-workflow.md` is right in a
// consumer (bootstrap stamped it) and right in the kit (only the .template
// exists here).
const CLEAN = {
  ".claude/skills/worktree-cleanup/SKILL.md":
    "# worktree-cleanup\nWraps `scripts/worktree-cleanup.sh`; the diary is `docs/diary.md`.\n",
  "scripts/worktree-cleanup.sh": "#!/bin/sh\n",
  "docs/diary.md": "# diary\n",
};

test("a skill whose path references all resolve is silent", () => {
  const ctx = ctxFor(CLEAN);
  assert.deepEqual(run(ctx), []);
  cleanup(ctx);
});

test("a dead path in a skill body is reported, as a warning", () => {
  // A warning, not a violation, because version skew is a sanctioned state:
  // the update recipe is per-category and requires a green gate BEFORE an
  // update starts, so a consumer can legally hold a skill that references an
  // article a later release delivers.
  const ctx = ctxFor({
    ...CLEAN,
    ".claude/skills/worktree-cleanup/SKILL.md":
      "# worktree-cleanup\nWraps `scripts/no-such-script.sh`.\n",
  });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "skill-path-missing"));
  assert.equal(out[0].file, ".claude/skills/worktree-cleanup/SKILL.md");
  assert.match(out[0].message, /no-such-script\.sh/);
  assert.equal(out[0].severity, "warning");
  cleanup(ctx);
});

test("a path that resolves only via its .template source is silent — the same skill is right on both sides of bootstrap", () => {
  const ctx = ctxFor({
    ".claude/skills/merge-train/SKILL.md":
      "# merge-train\nThe merge method lives in `constitution/local-workflow.md`.\n",
    // Content is irrelevant — the fallback is an existence check; a real mark
    // here would (correctly) trip the gate's own placeholder scan on this file.
    "constitution/local-workflow.md.template": "# workflow template stub\n",
  });
  assert.deepEqual(run(ctx), []);
  cleanup(ctx);
});

test("sidecar markdown inside a skill directory is scanned too", () => {
  const ctx = ctxFor({
    ...CLEAN,
    ".claude/skills/worktree-cleanup/DETAILS.md": "See `scripts/vanished.sh` for the mechanics.\n",
  });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.equal(out[0].file, ".claude/skills/worktree-cleanup/DETAILS.md");
  cleanup(ctx);
});

test("an exempted file's interior is skipped entirely, by reviewable config", () => {
  const cfg = {
    ...defaultConfig,
    skillPaths: {
      exemptFiles: [".claude/skills/worktree-cleanup/DETAILS.md"],
    },
  };
  const ctx = ctxFor(
    {
      ...CLEAN,
      ".claude/skills/worktree-cleanup/DETAILS.md":
        "Upstream-verbatim: see `scripts/vanished.sh`.\n",
    },
    cfg,
  );
  assert.deepEqual(run(ctx), []);
  cleanup(ctx);
});

test("an exempted token is skipped everywhere — for paths that exist only after something creates them", () => {
  const cfg = {
    ...defaultConfig,
    skillPaths: { exemptTokens: ["docs/reports/"] },
  };
  const ctx = ctxFor(
    {
      ...CLEAN,
      ".claude/skills/worktree-cleanup/SKILL.md":
        "# worktree-cleanup\nWrite the run up under `docs/reports/`.\n",
    },
    cfg,
  );
  assert.deepEqual(run(ctx), []);
  cleanup(ctx);
});

test("fenced blocks are quoted material, not references", () => {
  const ctx = ctxFor({
    ...CLEAN,
    ".claude/skills/worktree-cleanup/SKILL.md": [
      "# worktree-cleanup",
      "```sh",
      "cat scripts/only-in-a-fence.sh",
      "```",
      "Prose naming scripts/unbackticked.sh is narrative, not a reference.",
    ].join("\n"),
  });
  assert.deepEqual(run(ctx), []);
  cleanup(ctx);
});

test("a directory that is not a skill (no SKILL.md) is not scanned", () => {
  const ctx = ctxFor({
    ...CLEAN,
    ".claude/skills/notes/README.md": "See `scripts/gone.sh`.\n",
  });
  assert.deepEqual(run(ctx), []);
  cleanup(ctx);
});

// NOTE (centaur-spec local deviation): the kit's "end to end … gate still exits
// 0" test is intentionally omitted here. It spawns the full index.mjs against a
// BARE skill fixture and asserts exit 0 — which holds only for the kit's
// three-validator runner. This repo's runner.mjs is a recorded local fork that
// registers ELEVEN validators (see VERSION), so a bare fixture correctly trips
// the eight local docs-skeleton validators (adr-index-sync, event-names, …) and
// exits 1. The advisory-vs-violation exit behaviour is instead proven by this
// repo's own green `pnpm docs:check` (skill advisories, gate green); the unit
// tests above cover the validator's logic directly.

test("this repo's own skill interiors pass", () => {
  // The real repo: a dead path in a shipped skill is exactly the defect this
  // validator ships to catch downstream, so the kit must be clean under it —
  // with its shipped exemptions, exactly as a consumer runs it.
  const ctx = makeContext({ repoRoot: join(here, "..", "..", ".."), config: defaultConfig });
  assert.deepEqual(run(ctx), []);
});
