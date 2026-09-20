import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import defaultConfig from "../config.mjs";
import { makeContext } from "../context.mjs";
import { run } from "../validators/mutation-decision.mjs";
import { cleanup, ctxFor, hasRule, makeFixture } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// The engineering article once a consumer has filled it. The anchor line is
// the shape #91 stamped into the template; the validator only asks whether a
// filled article still carries it, in either of its two honest forms.
const FILLED = "# Engineering\n\n**Mutation decision**: mutant-rspec — run on demand.\n";
const NONE_FORM =
  "# Engineering\n\n**Mutation decision**: none — no team consensus yet, revisit at 1.0.\n";
const SILENT = "# Engineering\n\nWe test things. Trust us.\n";

test("an article naming a tool is silent", () => {
  const ctx = ctxFor({ "constitution/local-engineering.md": FILLED });
  assert.deepEqual(run(ctx), []);
  cleanup(ctx);
});

test("an explicit none-with-reason is silent — a recorded choice is the point", () => {
  const ctx = ctxFor({ "constitution/local-engineering.md": NONE_FORM });
  assert.deepEqual(run(ctx), []);
  cleanup(ctx);
});

test("an article with no decision line warns — and only warns", () => {
  const ctx = ctxFor({ "constitution/local-engineering.md": SILENT });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "mutation-decision-missing"));
  assert.equal(out[0].severity, "warning");
  assert.equal(out[0].file, "constitution/local-engineering.md");
  cleanup(ctx);
});

test("a label with nothing after it is not a decision", () => {
  const ctx = ctxFor({
    "constitution/local-engineering.md": "# Engineering\n\n**Mutation decision**:\n",
  });
  assert.ok(hasRule(run(ctx), "mutation-decision-missing"));
  cleanup(ctx);
});

test("an empty label mid-document is not a decision — the match must not cross the line break", () => {
  // The realistic shape: the anchor line sits above further sections, so a
  // regex whose whitespace class eats the newline would read the next
  // heading's first character as the decision (found by the independent
  // review of this wave, by executing the module).
  const ctx = ctxFor({
    "constitution/local-engineering.md":
      "# Engineering\n\n**Mutation decision**:\n\n## Code review\n\nWords.\n",
  });
  assert.ok(hasRule(run(ctx), "mutation-decision-missing"));
  cleanup(ctx);
});

test("CRLF line endings: an empty label still warns, a filled one is still silent", () => {
  const empty = ctxFor({
    "constitution/local-engineering.md": "# E\r\n\r\n**Mutation decision**:\r\nNext line.\r\n",
  });
  assert.ok(hasRule(run(empty), "mutation-decision-missing"));
  cleanup(empty);
  const filled = ctxFor({
    "constitution/local-engineering.md":
      "# E\r\n\r\n**Mutation decision**: mutant — on demand.\r\n",
  });
  assert.deepEqual(run(filled), []);
  cleanup(filled);
});

test("a label only inside a fenced code block is quoted material, not a decision", () => {
  const ctx = ctxFor({
    "constitution/local-engineering.md": [
      "# Engineering",
      "",
      "```md",
      "**Mutation decision**: the convention, quoted as an example.",
      "```",
      "",
      "No decision of our own.",
      "",
    ].join("\n"),
  });
  assert.ok(hasRule(run(ctx), "mutation-decision-missing"));
  cleanup(ctx);
});

test("the mutationDecision.article override points the rule at a different file", () => {
  // configWith only spreads claudeMdRefs, so build the config literally.
  const cfg = { ...defaultConfig, mutationDecision: { article: "docs/eng.md" } };
  const ctx = ctxFor({ "docs/eng.md": SILENT }, cfg);
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.equal(out[0].file, "docs/eng.md");
  cleanup(ctx);
});

test("no stamped article, no finding — the templates-stamped rule owns that state", () => {
  // The mark is spelled from parts: a literal one outside a .template is
  // itself a gate violation, and this test file is not a template.
  const mark = "{{" + "MUTATION_DECISION" + "}}";
  const ctx = ctxFor({
    "constitution/local-engineering.md.template": `**Mutation decision**: ${mark}\n`,
  });
  assert.deepEqual(run(ctx), []);
  cleanup(ctx);
});

test("this repo's own tree is silent — its stamped article records the decision", () => {
  const ctx = makeContext({ repoRoot: join(here, "..", "..", ".."), config: defaultConfig });
  assert.deepEqual(run(ctx), []);
});

// NOTE (centaur-spec local deviation): the kit's "end to end … gate still exits
// 0" test is intentionally omitted — it spawns the full index.mjs against a BARE
// fixture and asserts exit 0, which holds only for the kit's eight-validator
// runner. This repo's runner.mjs (a recorded fork, see VERSION) registers sixteen
// validators, so a bare fixture correctly exits 1 on the eight local
// docs-skeleton validators. The unit tests above cover the rule; `pnpm docs:check` proves the green case on the
// real tree.
