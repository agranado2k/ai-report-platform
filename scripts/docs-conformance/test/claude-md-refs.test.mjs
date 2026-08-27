import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "../validators/claude-md-refs.mjs";
import { cleanup, configWith, ctxFor, hasRule } from "./helpers.mjs";

// v0.10.0 renamed the root manual CLAUDE.md -> AGENTS.md and made CLAUDE.md /
// GEMINI.md shims that import it. These fixtures model that layout: the manual
// is `AGENTS.md`, its on-demand articles live under `constitution/`
// (config.claudeMdRefs.constitutionDir), the nested package manuals are
// `apps/mcp/AGENTS.md` / `packages/domain/AGENTS.md`, and the six shims are
// `@AGENTS.md`. The shims belong in the BASE fixture, not the shim tests alone:
// with a root manual present the validator checks every configured shim, so a
// fixture with a manual and no shims is a broken repo, not a neutral one.

const SHIMS = {
  "CLAUDE.md": "@AGENTS.md\n",
  "GEMINI.md": "@AGENTS.md\n",
  "apps/mcp/CLAUDE.md": "@AGENTS.md\n",
  "apps/mcp/GEMINI.md": "@AGENTS.md\n",
  "packages/domain/CLAUDE.md": "@AGENTS.md\n",
  "packages/domain/GEMINI.md": "@AGENTS.md\n",
};

// An AGENTS.md whose executable references all resolve. `/tdd` is a repo skill,
// `/loop` is a Claude Code built-in (config ignore list), the two paths exist.
const CONFORMANT = {
  "AGENTS.md": [
    "# Instructions",
    "Start with `/tdd <task>` for any code change.",
    "Compose with `/loop /pr-iterate <PR#>` for continuous iteration.",
    "Clean up via `scripts/worktree-cleanup.sh` (`--dry-run` to preview).",
    "The `.husky/pre-push` hook runs the docs guard.",
  ].join("\n"),
  ...SHIMS,
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
    "AGENTS.md": `${CONFORMANT["AGENTS.md"]}\nRun \`/ghost-command\` to do nothing.`,
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
    "AGENTS.md": `${CONFORMANT["AGENTS.md"]}\nEscalate with \`/security-review\` before merging.`,
  });
  const out = run(ctx);
  assert.deepEqual(out, []);
  cleanup(ctx);
});

test("does not treat multi-segment backticked paths as slash commands", () => {
  const ctx = ctxFor({
    ...CONFORMANT,
    "AGENTS.md": `${CONFORMANT["AGENTS.md"]}\nThe API lives at \`/api/v1/reports\`.`,
  });
  const out = run(ctx);
  assert.deepEqual(out, []);
  cleanup(ctx);
});

test("flags a referenced script path that does not exist", () => {
  const ctx = ctxFor({
    ...CONFORMANT,
    "AGENTS.md": `${CONFORMANT["AGENTS.md"]}\nOr let \`scripts/docs-prepush-guard.sh\` fire.`,
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

test("flags a referenced docs/ path that does not exist", () => {
  const ctx = ctxFor({
    ...CONFORMANT,
    "AGENTS.md": `${CONFORMANT["AGENTS.md"]}\nThe registry is \`docs/adr/GHOST-INDEX.md\`.`,
  });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "path-missing"));
  assert.match(out[0].message, /GHOST-INDEX/);
  cleanup(ctx);
});

test("still resolves references after a fenced code block (``` fences must not desync span pairing)", () => {
  const ctx = ctxFor({
    ...CONFORMANT,
    "AGENTS.md": [
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

// The reason a manual reaches for `~~~` at all is to show a ``` fence verbatim —
// which leaves an odd number of stray backticks in the document. Unstripped,
// that inverts every span pairing after it and the validator goes blind.
test("still resolves references after a ~~~ fenced block (~~~ fences must not desync span pairing)", () => {
  const ctx = ctxFor({
    ...CONFORMANT,
    "AGENTS.md": [
      "# Instructions",
      "1. Wrap shell snippets in a fence:",
      "",
      "   ~~~markdown",
      "   ```bash",
      "   git worktree add worktree/<slug> -b <type>/<slug>",
      "   ~~~",
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
    "AGENTS.md": `${CONFORMANT["AGENTS.md"]}\nNever run \`rm -rf /tmp\` or \`chmod +x /usr/local/bin\` here.`,
  });
  const out = run(ctx);
  assert.deepEqual(out, []);
  cleanup(ctx);
});

test("checks every /-token in a span that opens with a slash command", () => {
  const ctx = ctxFor({
    ...CONFORMANT,
    "AGENTS.md": `${CONFORMANT["AGENTS.md"]}\nCompose \`/loop /ghost-command <PR#>\` for continuous runs.`,
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
    "AGENTS.md": [
      CONFORMANT["AGENTS.md"],
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

test("stays silent when AGENTS.md does not exist (fixtures that don't model it)", () => {
  const ctx = ctxFor({ "docs/adr/INDEX.md": "# ADRs" });
  const out = run(ctx);
  assert.deepEqual(out, []);
  cleanup(ctx);
});

// ── The tool shims (CLAUDE.md / GEMINI.md and the nested copies) ──────────────
// v0.10.0's shim-invalid rule: each configured shim must import the root manual
// (`@AGENTS.md`) and hold nothing else but at most one HTML-comment line. A shim
// that grows a rule of its own is a second manual nobody diffs.

test("accepts a bare shim — the import line and nothing else", () => {
  const ctx = ctxFor({ ...CONFORMANT, "CLAUDE.md": "@AGENTS.md\n" });
  const out = run(ctx);
  assert.deepEqual(out, []);
  cleanup(ctx);
});

test("accepts a shim carrying a single HTML-comment line beside the import", () => {
  const ctx = ctxFor({
    ...CONFORMANT,
    "CLAUDE.md": "@AGENTS.md\n<!-- Entry point for Claude Code; the manual is AGENTS.md. -->\n",
  });
  const out = run(ctx);
  assert.deepEqual(out, []);
  cleanup(ctx);
});

test("flags a shim that carries a rule of its own (content beyond the import)", () => {
  const ctx = ctxFor({
    ...CONFORMANT,
    "GEMINI.md": "@AGENTS.md\n\n## Extra rule\nAlways prefer this tool.\n",
  });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "shim-invalid"));
  assert.equal(out[0].file, "GEMINI.md");
  cleanup(ctx);
});

test("flags a shim that never imports the root manual", () => {
  const ctx = ctxFor({ ...CONFORMANT, "GEMINI.md": "<!-- a shim -->\n" });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "shim-invalid"));
  assert.match(out[0].message, /never imports it/);
  cleanup(ctx);
});

test("flags a configured shim that does not exist on disk", () => {
  const files = { ...CONFORMANT };
  delete files["CLAUDE.md"];
  const ctx = ctxFor(files);
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "shim-invalid"));
  assert.equal(out[0].file, "CLAUDE.md");
  cleanup(ctx);
});

test("honours an empty shims list", () => {
  const files = { ...CONFORMANT };
  for (const shim of Object.keys(SHIMS)) delete files[shim];
  const ctx = ctxFor(files, configWith({ shims: [] }));
  const out = run(ctx);
  assert.deepEqual(out, []);
  cleanup(ctx);
});

test("stays silent about shims when there is no root manual to shim", () => {
  // A GEMINI.md with content but no AGENTS.md: nothing has been stamped yet, so
  // the shim is not "wrong", it just has no manual to point at.
  const ctx = ctxFor({ "GEMINI.md": "## a heading\n" });
  const out = run(ctx);
  assert.deepEqual(out, []);
  cleanup(ctx);
});

// ── The article layer (constitution/*.md) ────────────────────────────────────
// The root delegates its elaboration to articles that agents load on demand.
// They are standing instructions like the root is, so a stale command or a
// dead path poisons context exactly the same way — same checks, same rules.

// The stack article, not the shared one: `/tdd` and `.husky/pre-push` are
// exactly the local detail the portability guard below forbids in
// shared-invariants.md, so putting them there would conflate two rules.
const WITH_ARTICLE = {
  ...CONFORMANT,
  "AGENTS.md": [
    CONFORMANT["AGENTS.md"],
    "Elaboration lives in `constitution/local-engineering.md`.",
    "Process detail lives in `constitution/local-workflow.md`.",
  ].join("\n"),
  "constitution/local-workflow.md": "# Local workflow\nCurate commits before the PR.",
  "constitution/local-engineering.md": [
    "# Local engineering",
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
    "constitution/local-engineering.md": [
      WITH_ARTICLE["constitution/local-engineering.md"],
      "Then run `/ghost-command` to finish.",
    ].join("\n"),
  });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "skill-missing"));
  assert.equal(out[0].file, "constitution/local-engineering.md");
  assert.match(out[0].message, /ghost-command/);
  cleanup(ctx);
});

test("flags a dead path referenced from inside a constitution article", () => {
  const ctx = ctxFor({
    ...WITH_ARTICLE,
    "constitution/local-workflow.md": "Run `scripts/ghost-guard.sh` before pushing.",
  });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "path-missing"));
  assert.equal(out[0].file, "constitution/local-workflow.md");
  assert.match(out[0].message, /ghost-guard/);
  cleanup(ctx);
});

test("flags a constitution article referenced from the root but missing on disk", () => {
  const files = { ...WITH_ARTICLE };
  delete files["constitution/local-engineering.md"];
  const ctx = ctxFor(files);
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "path-missing"));
  assert.equal(out[0].file, "AGENTS.md");
  assert.match(out[0].message, /local-engineering/);
  cleanup(ctx);
});

test("checks articles even when the root AGENTS.md is absent", () => {
  const ctx = ctxFor({
    "constitution/local-engineering.md": "Run `/ghost-command` first.",
  });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "skill-missing"));
  assert.equal(out[0].file, "constitution/local-engineering.md");
  cleanup(ctx);
});

test("flags an article the root never references (unreachable — no agent will load it)", () => {
  const ctx = ctxFor({
    ...WITH_ARTICLE,
    "constitution/shared-invariants.md": "# Shared invariants\nTests are the target function.",
  });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "article-unreferenced"));
  assert.equal(out[0].file, "constitution/shared-invariants.md");
  assert.match(out[0].message, /AGENTS\.md/);
  cleanup(ctx);
});

test("stays silent about reachability when there is no root AGENTS.md to be reachable from", () => {
  const ctx = ctxFor({
    "constitution/shared-invariants.md": "# Shared invariants\nTests are the target function.",
  });
  const out = run(ctx);
  assert.deepEqual(out, []);
  cleanup(ctx);
});

// ── Nested package manuals (apps/mcp, packages/domain) ───────────────────────
// Claude Code loads a nested AGENTS.md when an agent works in that tree, so it
// is a standing instruction exactly like the root — and gets the same checks.
//
// THE RESOLUTION RULE (config.claudeMdRefs.pathRoots): a path token whose first
// segment is a repo-anchored root (`docs/`, `tests/`, `apps/`, …) resolves
// repo-relative from any manual; anything else inside a NESTED manual resolves
// against that manual's own directory. Repo-level manuals (root + articles)
// never resolve package-relative — they have no package to be relative to.

const NESTED_BASE = {
  ...CONFORMANT,
  "apps/mcp/src/instructions.ts": "export const INSTRUCTIONS = '';\n",
  "tests/evals/README.md": "# evals",
};

test("checks a nested package manual's slash commands", () => {
  const ctx = ctxFor({
    ...NESTED_BASE,
    "apps/mcp/AGENTS.md": "Run `/ghost-command` before editing the prompt surface.",
  });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "skill-missing"));
  assert.equal(out[0].file, "apps/mcp/AGENTS.md");
  cleanup(ctx);
});

test("resolves a nested manual's package-relative path against its own directory", () => {
  const ctx = ctxFor({
    ...NESTED_BASE,
    "apps/mcp/AGENTS.md": "Layer 0 is `src/instructions.ts` and `src/ghost.ts`.",
  });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "path-missing"));
  assert.equal(out[0].file, "apps/mcp/AGENTS.md");
  assert.match(out[0].message, /apps\/mcp\/src\/ghost\.ts/);
  cleanup(ctx);
});

test("resolves a repo-anchored first segment repo-relative even inside a nested manual", () => {
  const ctx = ctxFor({
    ...NESTED_BASE,
    // `tests/evals/README.md` exists at the REPO root, not under apps/mcp —
    // the anchored-root rule is what makes that reference legal.
    "apps/mcp/AGENTS.md": "The suite is `tests/evals/README.md`; Layer 0 is `src/instructions.ts`.",
  });
  const out = run(ctx);
  assert.deepEqual(out, []);
  cleanup(ctx);
});

test("flags a repo-anchored path that does not exist, referenced from a nested manual", () => {
  const ctx = ctxFor({
    ...NESTED_BASE,
    "apps/mcp/AGENTS.md": "See `docs/ghost-surface.md` for the prompt layers.",
  });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "path-missing"));
  assert.match(out[0].message, /ghost-surface/);
  cleanup(ctx);
});

test("does not treat bare filenames, globs or identifiers in a nested manual as paths", () => {
  const ctx = ctxFor({
    ...NESTED_BASE,
    "apps/mcp/AGENTS.md": [
      "`OVERCLAIM_PATTERNS` is asserted by `server.test.ts` and `prompts.test.ts`.",
      "Tests are `*.test.ts`; run `pnpm test` from here. The API is `/api/v1`.",
    ].join("\n"),
  });
  const out = run(ctx);
  assert.deepEqual(out, []);
  cleanup(ctx);
});

// The portability deny-list's repo-path regex admits `@`, so `@internal/foo.ts`
// counts as a path there. Package-relative resolution did not, so the same
// token inside a nested manual was silently unchecked — a dead reference that
// one guard calls a path and the other cannot see at all.
test("resolves an @-scoped package-relative path in a nested manual", () => {
  const ctx = ctxFor({
    ...NESTED_BASE,
    "apps/mcp/AGENTS.md": "The shim lives at `@internal/ghost/bar.ts`.",
  });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "path-missing"));
  assert.match(out[0].message, /apps\/mcp\/@internal\/ghost\/bar\.ts/);
  cleanup(ctx);
});

test("stays silent when a configured nested manual does not exist", () => {
  const ctx = ctxFor(CONFORMANT);
  const out = run(ctx);
  assert.deepEqual(out, []);
  cleanup(ctx);
});

test("checks tests/ paths referenced from the root manual", () => {
  const ctx = ctxFor({
    ...CONFORMANT,
    "AGENTS.md": `${CONFORMANT["AGENTS.md"]}\nThe browser tier lives in \`tests/ghost-tier/\`.`,
  });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "path-missing"));
  assert.match(out[0].message, /ghost-tier/);
  cleanup(ctx);
});

// ── Regex edges that used to fail open ───────────────────────────────────────

test("flags a slash command adjacent to trailing punctuation", () => {
  const ctx = ctxFor({
    ...CONFORMANT,
    "AGENTS.md": `${CONFORMANT["AGENTS.md"]}\nWhen finished, run \`/ghost-command.\``,
  });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "skill-missing"));
  assert.match(out[0].message, /ghost-command/);
  cleanup(ctx);
});

test("flags a slash command wrapped in punctuation inside a command-bearing span", () => {
  const ctx = ctxFor({
    ...CONFORMANT,
    "AGENTS.md": `${CONFORMANT["AGENTS.md"]}\nCompose \`/loop (/ghost-command), /tdd\` for continuous runs.`,
  });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "skill-missing"));
  assert.match(out[0].message, /ghost-command/);
  cleanup(ctx);
});

// A doubled span is how markdown quotes a span that itself contains backticks —
// e.g. showing `/tdd` verbatim. Paired on single backticks, the inner command is
// invisible: the pairing lands on the padding spaces instead.
test("parses a double-backtick span quoting a slash command", () => {
  const ctx = ctxFor({
    ...CONFORMANT,
    "AGENTS.md": `${CONFORMANT["AGENTS.md"]}\nWrite it as \`\` \`/ghost-command\` \`\` in the table.`,
  });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "skill-missing"));
  assert.match(out[0].message, /ghost-command/);
  cleanup(ctx);
});

test("parses a double-backtick span quoting a repo path", () => {
  const ctx = ctxFor({
    ...CONFORMANT,
    "AGENTS.md": `${CONFORMANT["AGENTS.md"]}\nWrite it as \`\` \`scripts/ghost-guard.sh\` \`\` in the table.`,
  });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "path-missing"));
  assert.match(out[0].message, /ghost-guard/);
  cleanup(ctx);
});

// ── Portability guard on the shared (framework) articles ─────────────────────
// ADR-0082 makes `cp shared-invariants.md <other repo>` the test of portability:
// the file "names no product, no package, no command, and no vendor". That claim
// is only real if something checks it. Deny-list + reasons live in config.mjs.

const PORTABLE = [
  "# Shared invariants",
  "",
  "## 3. Tests are the target function",
  "",
  "An agent optimizes for whatever signal you give it. Write the failing test first,",
  "then make it pass, then refactor. Continuous integration is the gate; mutation",
  "testing measures whether the suite can detect breakage at all.",
  "",
  "Standards findings go to agents, behavior findings go to humans; the split is",
  "never merged. Judgment is human-in-the-loop by label, and autonomy stops before",
  "the merge action. Where a rule needs a mechanism, see `local-workflow.md`.",
].join("\n");

test("passes when the shared article uses only framework-generic language", () => {
  const ctx = ctxFor({ "constitution/shared-invariants.md": PORTABLE });
  const out = run(ctx);
  assert.deepEqual(out, []);
  cleanup(ctx);
});

test("flags a product name in the shared article", () => {
  const ctx = ctxFor({
    "constitution/shared-invariants.md": `${PORTABLE}\nUploads land in Centaur Spec.`,
  });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "portability-leak"));
  assert.match(out[0].message, /product-name/);
  cleanup(ctx);
});

test("flags a vendor name in the shared article", () => {
  const ctx = ctxFor({
    "constitution/shared-invariants.md": `${PORTABLE}\nThe reviewer runs on GitHub Actions.`,
  });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "portability-leak"));
  assert.match(out[0].message, /vendor-name/);
  cleanup(ctx);
});

test("flags a deployment hostname in the shared article", () => {
  const ctx = ctxFor({
    "constitution/shared-invariants.md": `${PORTABLE}\nPublished at view.example.com.`,
  });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "portability-leak"));
  assert.match(out[0].message, /product-hostname/);
  cleanup(ctx);
});

test("flags a tool invocation in the shared article", () => {
  const ctx = ctxFor({
    "constitution/shared-invariants.md": `${PORTABLE}\nRun pnpm docs:check before pushing.`,
  });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "portability-leak"));
  assert.match(out[0].message, /tool-invocation/);
  cleanup(ctx);
});

// The path and command below both RESOLVE — they are real. Portability is a
// separate axis from existence: a correct reference is still a leak here.
test("flags a repo path in the shared article even when the path exists", () => {
  const ctx = ctxFor({
    ...CONFORMANT,
    "AGENTS.md": `${CONFORMANT["AGENTS.md"]}\nSee \`constitution/shared-invariants.md\`.`,
    "docs/adr/INDEX.md": "# ADRs",
    "constitution/shared-invariants.md": `${PORTABLE}\nThe registry is \`docs/adr/INDEX.md\`.`,
  });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "portability-leak"));
  assert.match(out[0].message, /repo-path/);
  cleanup(ctx);
});

test("flags a slash command in the shared article even when the skill exists", () => {
  const ctx = ctxFor({
    ...CONFORMANT,
    "AGENTS.md": `${CONFORMANT["AGENTS.md"]}\nSee \`constitution/shared-invariants.md\`.`,
    "constitution/shared-invariants.md": `${PORTABLE}\nStart with \`/tdd\`.`,
  });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "portability-leak"));
  assert.match(out[0].message, /slash-command/);
  cleanup(ctx);
});

// `sh` used to sit in the product-hostname TLD alternation, so every script
// filename in the article — `worktree-cleanup.sh` — read as a hostname. The
// leak was still caught, but under the wrong id, with a hint about deployment
// addresses that has nothing to do with a script path.
test("classifies a .sh script path as a repo path, not a deployment hostname", () => {
  const ctx = ctxFor({
    ...CONFORMANT,
    "AGENTS.md": `${CONFORMANT["AGENTS.md"]}\nSee \`constitution/shared-invariants.md\`.`,
    "scripts/worktree-cleanup.sh": "#!/usr/bin/env bash\n",
    "constitution/shared-invariants.md": `${PORTABLE}\nRun \`scripts/worktree-cleanup.sh\` afterwards.`,
  });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "portability-leak"));
  assert.match(out[0].message, /repo-path/);
  assert.doesNotMatch(out[0].message, /product-hostname/);
  cleanup(ctx);
});

test("stays silent about portability when the shared article does not exist", () => {
  const ctx = ctxFor(CONFORMANT);
  const out = run(ctx);
  assert.deepEqual(out, []);
  cleanup(ctx);
});
