import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "../validators/claude-md-refs.mjs";
import { cleanup, ctxFor, hasRule } from "./helpers.mjs";

// A CLAUDE.md whose executable references all resolve. `/tdd` is a repo skill,
// `/loop` is a Claude Code built-in (config ignore list), the two paths exist.
const CONFORMANT = {
  "CLAUDE.md": [
    "# Instructions",
    "Start with `/tdd <task>` for any code change.",
    "Compose with `/loop /pr-iterate <PR#>` for continuous iteration.",
    "Clean up via `scripts/worktree-cleanup.sh` (`--dry-run` to preview).",
    "The `.husky/pre-push` hook runs the docs guard.",
  ].join("\n"),
  ".claude/skills/tdd/SKILL.md": "# tdd",
  ".claude/skills/pr-iterate/SKILL.md": "# pr-iterate",
  "scripts/worktree-cleanup.sh": "#!/bin/sh\n",
  ".husky/pre-push": "pnpm docs:check\n",
};

test("passes when every slash command and path reference resolves", () => {
  const ctx = ctxFor(CONFORMANT);
  const out = run(ctx);
  assert.deepEqual(out, []);
  cleanup(ctx);
});

test("flags a slash command with no skill directory", () => {
  const ctx = ctxFor({
    ...CONFORMANT,
    "CLAUDE.md": `${CONFORMANT["CLAUDE.md"]}\nRun \`/ghost-command\` to do nothing.`,
  });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "skill-missing"));
  assert.match(out[0].message, /ghost-command/);
  cleanup(ctx);
});

test("ignores commands on the config ignore list (Claude Code built-ins)", () => {
  const ctx = ctxFor({
    ...CONFORMANT,
    "CLAUDE.md": `${CONFORMANT["CLAUDE.md"]}\nEscalate with \`/security-review\` before merging.`,
  });
  const out = run(ctx);
  assert.deepEqual(out, []);
  cleanup(ctx);
});

test("does not treat multi-segment backticked paths as slash commands", () => {
  const ctx = ctxFor({
    ...CONFORMANT,
    "CLAUDE.md": `${CONFORMANT["CLAUDE.md"]}\nThe API lives at \`/api/v1/reports\`.`,
  });
  const out = run(ctx);
  assert.deepEqual(out, []);
  cleanup(ctx);
});

test("flags a referenced script path that does not exist", () => {
  const ctx = ctxFor({
    ...CONFORMANT,
    "CLAUDE.md": `${CONFORMANT["CLAUDE.md"]}\nOr let \`scripts/docs-prepush-guard.sh\` fire.`,
  });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "path-missing"));
  assert.match(out[0].message, /docs-prepush-guard/);
  cleanup(ctx);
});

test("flags a referenced husky hook that does not exist", () => {
  const files = { ...CONFORMANT };
  delete files[".husky/pre-push"];
  const ctx = ctxFor(files);
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "path-missing"));
  assert.match(out[0].message, /pre-push/);
  cleanup(ctx);
});

test("still resolves references after a fenced code block (``` fences must not desync span pairing)", () => {
  const ctx = ctxFor({
    ...CONFORMANT,
    "CLAUDE.md": [
      "# Instructions",
      "1. Use a worktree:",
      "",
      "   ```bash",
      "   git worktree add worktree/<slug> -b <type>/<slug>",
      "   ```",
      "",
      "Then run `/ghost-command` to proceed.",
      "And `/tdd <task>` as usual.",
    ].join("\n"),
  });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "skill-missing"));
  assert.match(out[0].message, /ghost-command/);
  cleanup(ctx);
});

test("ignores /-tokens in spans that don't open with a slash command (shell snippets, path args)", () => {
  const ctx = ctxFor({
    ...CONFORMANT,
    "CLAUDE.md": `${CONFORMANT["CLAUDE.md"]}\nNever run \`rm -rf /tmp\` or \`chmod +x /usr/local/bin\` here.`,
  });
  const out = run(ctx);
  assert.deepEqual(out, []);
  cleanup(ctx);
});

test("checks every /-token in a span that opens with a slash command", () => {
  const ctx = ctxFor({
    ...CONFORMANT,
    "CLAUDE.md": `${CONFORMANT["CLAUDE.md"]}\nCompose \`/loop /ghost-command <PR#>\` for continuous runs.`,
  });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "skill-missing"));
  assert.match(out[0].message, /ghost-command/);
  cleanup(ctx);
});

test("checks .claude/skills and .claude/hooks literal path references", () => {
  const ctx = ctxFor({
    ...CONFORMANT,
    "CLAUDE.md": [
      CONFORMANT["CLAUDE.md"],
      "The procedural skill is at `.claude/skills/tdd/SKILL.md`.",
      "See also `.claude/skills/ghost/SKILL.md`.",
      "Enforcement lives in `.claude/hooks/tdd-guard.sh`.",
    ].join("\n"),
  });
  const out = run(ctx);
  assert.equal(out.length, 2);
  assert.ok(out.every((v) => v.rule === "path-missing"));
  assert.match(out.map((v) => v.message).join(" "), /ghost/);
  assert.match(out.map((v) => v.message).join(" "), /tdd-guard/);
  cleanup(ctx);
});

test("stays silent when CLAUDE.md does not exist (fixtures that don't model it)", () => {
  const ctx = ctxFor({ "docs/adr/INDEX.md": "# ADRs" });
  const out = run(ctx);
  assert.deepEqual(out, []);
  cleanup(ctx);
});

// ── The article layer (.claude/constitution/*.md) ────────────────────────────
// The root delegates its elaboration to articles that agents load on demand.
// They are standing instructions like the root is, so a stale command or a
// dead path poisons context exactly the same way — same checks, same rules.

const WITH_ARTICLE = {
  ...CONFORMANT,
  "CLAUDE.md": [
    CONFORMANT["CLAUDE.md"],
    "Elaboration lives in `.claude/constitution/shared-invariants.md`.",
  ].join("\n"),
  ".claude/constitution/shared-invariants.md": [
    "# Shared invariants",
    "Tests are the target function — start with `/tdd`.",
    "The pairing guard lives in `.husky/pre-push`.",
  ].join("\n"),
};

test("passes when a constitution article's references all resolve", () => {
  const ctx = ctxFor(WITH_ARTICLE);
  const out = run(ctx);
  assert.deepEqual(out, []);
  cleanup(ctx);
});

test("flags a stale slash command inside a constitution article", () => {
  const ctx = ctxFor({
    ...WITH_ARTICLE,
    ".claude/constitution/shared-invariants.md": [
      WITH_ARTICLE[".claude/constitution/shared-invariants.md"],
      "Then run `/ghost-command` to finish.",
    ].join("\n"),
  });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "skill-missing"));
  assert.equal(out[0].file, ".claude/constitution/shared-invariants.md");
  assert.match(out[0].message, /ghost-command/);
  cleanup(ctx);
});

test("flags a dead path referenced from inside a constitution article", () => {
  const ctx = ctxFor({
    ...WITH_ARTICLE,
    ".claude/constitution/local-workflow.md": "Run `scripts/ghost-guard.sh` before pushing.",
  });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "path-missing"));
  assert.equal(out[0].file, ".claude/constitution/local-workflow.md");
  assert.match(out[0].message, /ghost-guard/);
  cleanup(ctx);
});

test("flags a constitution article referenced from the root but missing on disk", () => {
  const files = { ...WITH_ARTICLE };
  delete files[".claude/constitution/shared-invariants.md"];
  const ctx = ctxFor(files);
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "path-missing"));
  assert.equal(out[0].file, "CLAUDE.md");
  assert.match(out[0].message, /shared-invariants/);
  cleanup(ctx);
});

test("checks articles even when the root CLAUDE.md is absent", () => {
  const ctx = ctxFor({
    ".claude/constitution/shared-invariants.md": "Run `/ghost-command` first.",
  });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "skill-missing"));
  assert.equal(out[0].file, ".claude/constitution/shared-invariants.md");
  cleanup(ctx);
});
