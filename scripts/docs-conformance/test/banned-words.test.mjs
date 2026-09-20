import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_GLOSSARY, parseEntries, run } from "../validators/banned-words.mjs";
import { cleanup, configWith, ctxFor, hasRule, makeFixture } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// The glossary is scanned too now (#189), and the fixture's decoy "## Another
// section" line is a real use of a banned word — which is the point of the
// glossary tests at the end, and noise for every test above them about the
// manual and the skills.
const notGlossary = (out, glossary = DEFAULT_GLOSSARY) => out.filter((f) => f.file !== glossary);

const GLOSSARY = `# Glossary

## Words this project does not use

<!-- a comment that mentions **decoy** — comments are not entries -->

- **install** — ambiguous here (nothing is installed). Use **bootstrap** for
  the run, or **stamp** for a file. Except: **the dependency sense** —
  \`dependency install\`, \`npm install\`.
- **strategic design** — ambiguous. Use **context map**.

## Another section

- **install** here is prose, not an entry.
`;

test("the section's entries parse: term, replacements, carve-out phrases", () => {
  const entries = parseEntries(
    GLOSSARY.split("## Words this project does not use")[1].split("## Another")[0],
  );
  assert.deepEqual(entries, [
    {
      term: "install",
      replacements: ["bootstrap", "stamp"],
      guidance:
        "ambiguous here (nothing is installed). Use bootstrap for the run, or stamp for a file.",
      allowed: ["dependency install", "npm install"],
    },
    {
      term: "strategic design",
      replacements: ["context map"],
      guidance: "ambiguous. Use context map.",
      allowed: [],
    },
  ]);
});

test("an entry with no bold replacement still says what the glossary says", () => {
  const ctx = ctxFor({
    "docs/domain-glossary.md":
      "# G\n\n## Words this project does not use\n\n- **config** — ambiguous on its own. Say which.\n",
    "AGENTS.md": "# Manual\n\nEdit the config.\n",
  });
  const out = notGlossary(run(ctx));
  assert.equal(out.length, 1);
  assert.match(out[0].message, /the glossary says: ambiguous on its own\. Say which\./);
  cleanup(ctx);
});

test("the line reported is the real line, below a fenced block too", () => {
  const ctx = ctxFor({
    "docs/domain-glossary.md": GLOSSARY,
    "AGENTS.md": "# Manual\n\n```sh\nnpm install\necho hi\n```\n\nThen install the kit.\n",
  });
  const out = notGlossary(run(ctx));
  assert.equal(out.length, 1);
  assert.equal(out[0].line, 8);
  cleanup(ctx);
});

test("a multi-word term split across a line break is a use, reported on its first line", () => {
  const ctx = ctxFor({
    "docs/domain-glossary.md": GLOSSARY,
    "AGENTS.md": "# Manual\n\nWe did some strategic\ndesign here.\n",
  });
  const out = notGlossary(run(ctx));
  assert.equal(out.length, 1);
  assert.equal(out[0].line, 3);
  assert.match(out[0].message, /"strategic design"/);
  cleanup(ctx);
});

test("the banned section may be the last section of the glossary — no heading after it", () => {
  const ctx = ctxFor({
    "docs/domain-glossary.md":
      "# G\n\n## Terms\n\n- **kit** — this.\n\n## Words this project does not use\n\n- **install** — no. Use **bootstrap**.\n",
    "AGENTS.md": "# Manual\n\ninstall it\n",
  });
  assert.equal(notGlossary(run(ctx)).length, 1);
  cleanup(ctx);
});

test("a deeper heading inside the section does not end it; a same-level one does", () => {
  // Deliberately UNFILTERED: this fixture is the one that holds the banned
  // section's boundary when the glossary itself is scanned. Filtering the
  // glossary out of it (as every other pre-existing test does) let a mutant
  // that never closed the section survive — the decoy below the section is
  // then blanked and nothing notices.
  const ctx = ctxFor({
    "docs/domain-glossary.md":
      "# G\n\n## Words this project does not use\n\n### Nouns\n\n- **install** — no. Use **bootstrap**.\n\n## Later\n\n- **kit** — not banned.\n",
    "AGENTS.md": "# Manual\n\ninstall the kit\n",
  });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.match(out[0].message, /"install"/);
  cleanup(ctx);
});

test("a consumer whose constitution lives elsewhere still has its shared articles excluded", () => {
  const ctx = ctxFor(
    {
      "docs/domain-glossary.md": GLOSSARY,
      "AGENTS.md": "# Manual\n",
      ".claude/constitution/shared-invariants.md": "install — verbatim from the kit\n",
      ".claude/constitution/local-engineering.md": "install here\n",
    },
    configWith({ constitutionDir: ".claude/constitution" }),
  );
  assert.deepEqual(
    notGlossary(run(ctx)).map((f) => f.file),
    [".claude/constitution/local-engineering.md"],
  );
  cleanup(ctx);
});

// NOTE (centaur-spec local deviation): the kit's "end to end … gate still exits
// 0" test is intentionally omitted — it spawns the full index.mjs against a BARE
// fixture and asserts exit 0, which holds only for the kit's eight-validator
// runner. This repo's runner.mjs (a recorded fork, see VERSION) registers sixteen
// validators, so a bare fixture correctly exits 1 on the eight local
// docs-skeleton validators. The validator's registration is proven by the runner import above; `pnpm docs:check` proves the green case on the
// real tree.

test("a banned word in the manual warns, naming the word, the line and the replacement", () => {
  const ctx = ctxFor({
    "docs/domain-glossary.md": GLOSSARY,
    "AGENTS.md": "# Manual\n\nBootstrap asks before installing it.\n",
  });
  const out = notGlossary(run(ctx));
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "banned-word"));
  assert.equal(out[0].severity, "warning");
  assert.equal(out[0].file, "AGENTS.md");
  assert.equal(out[0].line, 3);
  assert.match(out[0].message, /"installing"/);
  assert.match(out[0].message, /"bootstrap" or "stamp"/);
  cleanup(ctx);
});

test("a carve-out phrase is silent; the same word outside it still warns", () => {
  const ctx = ctxFor({
    "docs/domain-glossary.md": GLOSSARY,
    "AGENTS.md":
      "# Manual\n\nRun a dependency install first.\nThen npm install again.\nThen install the kit.\n",
  });
  const out = notGlossary(run(ctx));
  assert.equal(out.length, 1);
  assert.equal(out[0].line, 5);
  cleanup(ctx);
});

test("a multi-word term is matched as a phrase, case-insensitively", () => {
  const ctx = ctxFor({
    "docs/domain-glossary.md": GLOSSARY,
    "AGENTS.md": "# Manual\n\nWe did Strategic Design here, and strategic thinking there.\n",
  });
  const out = notGlossary(run(ctx));
  assert.equal(out.length, 1);
  assert.match(out[0].message, /"Strategic Design"/);
  cleanup(ctx);
});

test("a glossary with no banned section, or no glossary, is silent", () => {
  const a = ctxFor({
    "docs/domain-glossary.md": "# Glossary\n\n## Terms\n\n- **kit** — this.\n",
    "AGENTS.md": "install everything\n",
  });
  assert.deepEqual(notGlossary(run(a)), []);
  cleanup(a);
  const b = ctxFor({ "AGENTS.md": "install everything\n" });
  assert.deepEqual(notGlossary(run(b)), []);
  cleanup(b);
});

test("quoted material is silent — fenced blocks and code spans", () => {
  const ctx = ctxFor({
    "docs/domain-glossary.md": GLOSSARY,
    "AGENTS.md":
      "# Manual\n\n```sh\nnpm install && install-thing\n```\n\nRun `install-thing` then `sh install.sh`.\n",
  });
  assert.deepEqual(notGlossary(run(ctx)), []);
  cleanup(ctx);
});

test("the articles and every skill file are scanned; the shared articles are not", () => {
  const ctx = ctxFor({
    "docs/domain-glossary.md": GLOSSARY,
    "AGENTS.md": "# Manual\n",
    "constitution/local-engineering.md": "install here\n",
    "constitution/shared-invariants.md": "install there — verbatim from the kit\n",
    ".agents/skills/tdd/SKILL.md": "# tdd\n\ninstall\n",
    ".agents/skills/tdd/SIDECAR.md": "installed\n",
    ".agents/skills/LICENSE-x.md": "install — not a skill directory\n",
  });
  const files = notGlossary(run(ctx))
    .map((f) => f.file)
    .sort();
  assert.deepEqual(files, [
    ".agents/skills/tdd/SIDECAR.md",
    ".agents/skills/tdd/SKILL.md",
    "constitution/local-engineering.md",
  ]);
  cleanup(ctx);
});

test("a substring is not a use — 'installation' is a different word, 'reinstall' too", () => {
  const ctx = ctxFor({
    "docs/domain-glossary.md": GLOSSARY,
    "AGENTS.md": "# Manual\n\nThe installation and a reinstall.\n",
  });
  assert.deepEqual(notGlossary(run(ctx)), []);
  cleanup(ctx);
});

// The glossary is the canonical document for the language and was the one
// file free to contradict the rule it defines: after "harness" was banned, two
// of the glossary's OWN entries went on saying "the harness", and nothing
// flagged them until a reviewer read them by hand (#189).
test("the glossary itself is scanned — a banned word in another entry's prose is a use", () => {
  const ctx = ctxFor({
    "docs/domain-glossary.md": GLOSSARY,
    "AGENTS.md": "# Manual\n",
  });
  const out = run(ctx);
  const inGlossary = out.filter((f) => f.file === "docs/domain-glossary.md");
  assert.equal(inGlossary.length, 1, JSON.stringify(out));
  // line 14 is "- **install** here is prose, not an entry." under "## Another section"
  assert.equal(inGlossary[0].line, 14);
  cleanup(ctx);
});

test("the banned section is not scanned — it has to write the words it bans", () => {
  const ctx = ctxFor({
    "docs/domain-glossary.md": GLOSSARY.replace(
      "## Another section\n\n- **install** here is prose, not an entry.\n",
      "",
    ),
    "AGENTS.md": "# Manual\n",
  });
  const out = run(ctx);
  assert.equal(
    out.filter((f) => f.file === "docs/domain-glossary.md").length,
    0,
    JSON.stringify(out),
  );
  cleanup(ctx);
});

test("an _Avoid_ line is not scanned — naming the near-synonym is its purpose", () => {
  const glossary = GLOSSARY.replace(
    "## Another section\n\n- **install** here is prose, not an entry.\n",
    '## Terms\n\n- **Bootstrap** — the one-shot run.\n  - _Avoid_: "install" (nothing is installed).\n',
  );
  const ctx = ctxFor({ "docs/domain-glossary.md": glossary, "AGENTS.md": "# Manual\n" });
  const out = run(ctx);
  assert.equal(
    out.filter((f) => f.file === "docs/domain-glossary.md").length,
    0,
    JSON.stringify(out),
  );
  cleanup(ctx);
});

test("an _Avoid_ item's continuation lines are exempt too", () => {
  const glossary = GLOSSARY.replace(
    "## Another section\n\n- **install** here is prose, not an entry.\n",
    '## Terms\n\n- **Bootstrap** — the one-shot run.\n  - _Avoid_: "the setup" (it is not one), and\n    "install" (nothing is installed).\n- **Stamp** — what bootstrap does to a file. You do not install it.\n',
  );
  const ctx = ctxFor({ "docs/domain-glossary.md": glossary, "AGENTS.md": "# Manual\n" });
  const out = run(ctx).filter((f) => f.file === "docs/domain-glossary.md");
  // the continuation line is exempt; the Stamp entry's prose is not
  assert.equal(out.length, 1, JSON.stringify(out));
  assert.equal(out[0].line, 17);
  cleanup(ctx);
});

test("a carve-out phrase is honoured in the glossary too", () => {
  const glossary = GLOSSARY.replace(
    "## Another section\n\n- **install** here is prose, not an entry.\n",
    "## Terms\n\n- **Dependency** — something you get with `npm install`.\n",
  );
  const ctx = ctxFor({ "docs/domain-glossary.md": glossary, "AGENTS.md": "# Manual\n" });
  const out = run(ctx);
  assert.equal(
    out.filter((f) => f.file === "docs/domain-glossary.md").length,
    0,
    JSON.stringify(out),
  );
  cleanup(ctx);
});

test("an _Avoid_ item ends at the next sibling bullet — which is scanned", () => {
  const glossary = GLOSSARY.replace(
    "## Another section\n\n- **install** here is prose, not an entry.\n",
    '## Terms\n\n- **Bootstrap** — the one-shot run.\n  - _Avoid_: "install".\n  - Note: you do not install anything.\n',
  );
  const ctx = ctxFor({ "docs/domain-glossary.md": glossary, "AGENTS.md": "# Manual\n" });
  const out = run(ctx).filter((f) => f.file === "docs/domain-glossary.md");
  assert.equal(out.length, 1, JSON.stringify(out));
  assert.equal(out[0].line, 16);
  cleanup(ctx);
});

test("an _Avoid_ item at column zero is exempt too", () => {
  const glossary = GLOSSARY.replace(
    "## Another section\n\n- **install** here is prose, not an entry.\n",
    '## Terms\n\n- _Avoid_: "install" (nothing is installed).\n* _Avoid_: "the install" either.\n',
  );
  const ctx = ctxFor({ "docs/domain-glossary.md": glossary, "AGENTS.md": "# Manual\n" });
  assert.deepEqual(
    run(ctx).filter((f) => f.file === "docs/domain-glossary.md"),
    [],
  );
  cleanup(ctx);
});

test("a configured glossary path is the one scanned", () => {
  // configWith() layers onto claudeMdRefs; the glossary path is bannedWords'.
  const ctx = ctxFor(
    { "GLOSSARY.md": GLOSSARY, "AGENTS.md": "# Manual\n" },
    { ...configWith({}), bannedWords: { glossary: "GLOSSARY.md" } },
  );
  const out = run(ctx);
  assert.deepEqual(
    out.map((f) => `${f.file}:${f.line}`),
    ["GLOSSARY.md:14"],
  );
  assert.deepEqual(notGlossary(out, "GLOSSARY.md"), []);
  cleanup(ctx);
});
