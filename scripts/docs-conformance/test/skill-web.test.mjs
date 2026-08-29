import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import defaultConfig from "../config.mjs";
import { makeContext } from "../context.mjs";
import { run } from "../validators/skill-web.mjs";
import { cleanup, configWith, ctxFor, hasRule, makeFixture } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// A complete web: every cross-skill reference resolves, and the one
// agent-harness built-in (`/loop`) is on the shipped ignore list. This is the
// half-adopted-state validator, so the fixtures model exactly the failure #69
// surfaced: a skill that references a sibling the project never installed.
const WEB = {
  ".claude/skills/implement/SKILL.md":
    "# implement\nEnd by running `/review-pr`, and append the `/explain-diff` output.\n",
  ".claude/skills/review-pr/SKILL.md": "# review-pr\nHand surviving findings to `/pr-iterate`.\n",
  ".claude/skills/pr-iterate/SKILL.md": "# pr-iterate\nCompose as `/loop /pr-iterate <PR#>`.\n",
  ".claude/skills/explain-diff/SKILL.md": "# explain-diff\n",
};

test("a complete skill web is silent", () => {
  const ctx = ctxFor(WEB);
  assert.deepEqual(run(ctx), []);
  cleanup(ctx);
});

test("a reference to an uninstalled skill is reported, as a warning", () => {
  const { [".claude/skills/explain-diff/SKILL.md"]: _gone, ...half } = WEB;
  const ctx = ctxFor(half);
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "skill-web-dangling"));
  assert.equal(out[0].severity, "warning");
  assert.equal(out[0].file, ".claude/skills/implement/SKILL.md");
  assert.match(out[0].message, /explain-diff/);
  cleanup(ctx);
});

test("every finding this validator emits is a warning — declining a skill is a legal state", () => {
  const ctx = ctxFor({
    ".claude/skills/a/SKILL.md": "Run `/b` then `/c`.\n",
  });
  const out = run(ctx);
  assert.ok(out.length >= 2);
  assert.ok(out.every((f) => f.severity === "warning"));
  cleanup(ctx);
});

test("the shared ignore list applies — agent-harness built-ins are not skills", () => {
  // `/loop` is on the shipped claudeMdRefs.ignoreCommands list; the web
  // validator reads the SAME list, so one exemption serves both validators.
  const ctx = ctxFor({
    ".claude/skills/pr-iterate/SKILL.md": WEB[".claude/skills/pr-iterate/SKILL.md"],
  });
  assert.deepEqual(run(ctx), []);
  cleanup(ctx);
});

test("a config-extended ignore list is honored", () => {
  const ctx = ctxFor(
    { ".claude/skills/a/SKILL.md": "Escalate with `/local-only-tool`.\n" },
    configWith({
      ignoreCommands: [...(defaultConfig.claudeMdRefs.ignoreCommands ?? []), "/local-only-tool"],
    }),
  );
  assert.deepEqual(run(ctx), []);
  cleanup(ctx);
});

test("fenced code blocks and bare prose do not count — only code spans carry references", () => {
  const ctx = ctxFor({
    ".claude/skills/a/SKILL.md": [
      "# a",
      "Bare prose mention of /ghost is narrative, not a reference.",
      "```sh",
      "echo 'a fence quoting /ghost is quoted material'",
      "```",
    ].join("\n"),
  });
  assert.deepEqual(run(ctx), []);
  cleanup(ctx);
});

test("this repo's own skill web is complete", () => {
  // The real repo, not a fixture: a dangling reference in a shipped skill is
  // exactly the defect this validator exists to catch, so this repo itself must
  // be silent under it (with its shipped ignoreCommands, as a consumer runs it).
  const ctx = makeContext({ repoRoot: join(here, "..", "..", ".."), config: defaultConfig });
  assert.deepEqual(run(ctx), []);
});

test("warnings and violations together: both blocks print and the gate still fails", () => {
  // The severity boundary's mixed case: an advisory must not swallow a real
  // violation (the run fails), and a violation must not swallow the advisory
  // (both blocks print). A regression that early-exits after either block
  // passes the warn-only and violation-only tests and only this one.
  const SHIM =
    "<!-- Shim: the agent manual is AGENTS.md. Edit that file, not this one. -->\n@AGENTS.md\n";
  const root = makeFixture({
    "AGENTS.md": "Run `/ghost-command` for nothing.\n",
    "CLAUDE.md": SHIM,
    "GEMINI.md": SHIM,
    ".claude/skills/implement/SKILL.md": "End by appending the `/explain-diff` output.\n",
  });
  const res = spawnSync(process.execPath, [join(here, "..", "index.mjs"), root], {
    encoding: "utf8",
  });
  assert.equal(res.status, 1, `expected exit 1, got ${res.status}\n${res.stderr}`);
  assert.match(res.stderr, /WARN {2}docs conformance: advisories/);
  assert.match(res.stderr, /skill-web-dangling/);
  assert.match(res.stderr, /FAIL {2}docs conformance: violations found/);
  assert.match(res.stderr, /skill-missing/);
});

// NOTE (centaur-spec local deviation): the kit's "end to end … gate still exits
// 0" test is intentionally omitted — it spawns the full index.mjs against a BARE
// fixture and asserts exit 0, which holds only for the kit's three-validator
// runner. This repo's runner.mjs (a recorded fork, see VERSION) registers eleven
// validators, so a bare fixture correctly exits 1 on the eight local
// docs-skeleton validators. The "warnings and violations together" test above
// (exit 1, both blocks present) still exercises the advisory/violation split
// under this repo's real runner, and `pnpm docs:check` proves the green case.
