// The KEYLESS tier of the prompt-eval suite (ADR-0083, issue #264).
//
// The eval suite itself needs a provider API key and costs money, so it only
// runs in `.github/workflows/prompt-evals.yml`. This file is its structural
// guard and runs in the ordinary `pnpm test` gate with no key at all: it proves
// the harness is WELL-FORMED (config parses, every referenced file exists,
// every golden-set case carries a reference solution, the tool fixture still
// matches the live registrations) so a broken eval setup fails fast in the
// fast gate rather than silently on a PR that touches a prompt surface.
//
// It deliberately asserts nothing about MODEL BEHAVIOUR — that is the eval
// tier's job, and faking it here would be the "test asks for less" failure
// mode ADR-0081 exists to catch.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  captureRegisteredTools,
  INSTRUCTIONS,
  overclaimPhrases,
  registeredToolNames,
  toolsForProvider,
} from "./surface";

const EVALS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(EVALS_DIR, "..", "..");

const CONFIG_PATH = join(EVALS_DIR, "promptfooconfig.yaml");

const POLARITIES = ["positive", "negative"] as const;
type Polarity = (typeof POLARITIES)[number];

// The PRD's target (issue #264, ADR-0083 §7) is 20–50 cases drawn from REAL
// observed failures. The suite originally shipped a looser seed range (≥15) so
// the first commit could land under it; the window below is the target itself,
// so a suite that shrinks back below the target fails the fast gate instead of
// quietly measuring less.
const MIN_CASES = 20;
const MAX_CASES = 50;

// Polarity balance is a PROPORTION, not a pair of absolutes. An absolute floor
// of 5 is only meaningful at the bottom of the window: at 40 cases it accepts a
// 34/6 split — a suite that is nominally balanced and effectively one-sided,
// because the minority polarity stops buying discrimination as the set grows.
// The floor scales with the suite instead.
const MIN_POLARITY_SHARE = 0.3;
const polarityFloor = (total: number): number => Math.ceil(total * MIN_POLARITY_SHARE);

interface GoldenCase {
  description?: unknown;
  vars?: { scenario?: unknown };
  metadata?: {
    polarity?: unknown;
    expected_tools?: unknown;
    forbidden_tools?: unknown;
    acceptable_tools?: unknown;
    expected_args?: unknown;
    grounded_in?: unknown;
    rationale?: unknown;
    guard?: unknown;
    /** `describe-boundary` opts a guard case out of the negation-blind phrase
     *  blocklist; see the tests below for what it must provide instead. */
    guard_mode?: unknown;
  };
  assert?: AssertNode[];
}

interface AssertNode {
  type?: unknown;
  value?: unknown;
  /** `assert-set` groups alternatives; its members live here. */
  assert?: AssertNode[];
}

/** Depth-first: every node including `assert-set` groups AND their members. */
function flattenAsserts(nodes: AssertNode[]): AssertNode[] {
  return nodes.flatMap((node) => [node, ...flattenAsserts(node.assert ?? [])]);
}

interface PromptfooConfig {
  description?: string;
  prompts?: string[];
  providers?: (string | { id?: string; label?: string; config?: Record<string, unknown> })[];
  defaultTest?: {
    assert?: { type?: string; value?: unknown }[];
    options?: Record<string, unknown>;
  };
  tests?: string[];
}

function readConfig(): PromptfooConfig {
  expect(existsSync(CONFIG_PATH), `${CONFIG_PATH} must exist`).toBe(true);
  // Parse, do not string-match: a config that no longer parses as YAML is the
  // single most likely way this suite silently stops running.
  return parseYaml(readFileSync(CONFIG_PATH, "utf8")) as PromptfooConfig;
}

/** Resolve a promptfoo `file://` reference (relative to the config) to a path. */
function resolveFileRef(ref: string): string {
  return resolve(EVALS_DIR, ref.replace(/^file:\/\//, ""));
}

/** Expand the config's `tests:` globs into the golden-set files they name. */
function goldenSetFiles(config: PromptfooConfig): string[] {
  const refs = config.tests ?? [];
  expect(
    refs.length,
    "promptfooconfig.yaml must declare at least one tests: entry",
  ).toBeGreaterThan(0);
  return refs.map(resolveFileRef);
}

function loadGoldenSet(config: PromptfooConfig): { file: string; cases: GoldenCase[] }[] {
  return goldenSetFiles(config).map((file) => {
    expect(existsSync(file), `golden-set file referenced by the config is missing: ${file}`).toBe(
      true,
    );
    const cases = parseYaml(readFileSync(file, "utf8")) as GoldenCase[];
    expect(Array.isArray(cases), `${file} must be a YAML list of promptfoo test cases`).toBe(true);
    return { file, cases };
  });
}

function allCases(config: PromptfooConfig): GoldenCase[] {
  return loadGoldenSet(config).flatMap(({ cases }) => cases);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

describe("promptfoo config (tests/evals/promptfooconfig.yaml)", () => {
  it("parses as YAML", () => {
    const config = readConfig();
    expect(config).toBeTypeOf("object");
    expect(config).not.toBeNull();
  });

  it("declares an Anthropic provider carrying the real tool definitions", () => {
    const providers = readConfig().providers ?? [];
    expect(providers.length, "at least one provider must be configured").toBeGreaterThan(0);
    const primary = providers[0];
    expect(typeof primary === "object" && primary !== null).toBe(true);
    const provider = primary as { id?: string; config?: Record<string, unknown> };
    expect(provider.id, "the default provider is an anthropic: model (ADR-0083)").toMatch(
      /^anthropic:/,
    );
    expect(
      provider.config?.tools,
      "the provider must be handed the generated MCP tool definitions",
    ).toBe("file://fixtures/mcp-tools.json");
  });

  it("references only files that exist", () => {
    const config = readConfig();
    const refs = [
      ...(config.prompts ?? []),
      ...(config.tests ?? []),
      ...(config.providers ?? []).flatMap((p) =>
        typeof p === "object" && p !== null ? Object.values(p.config ?? {}) : [],
      ),
      ...(config.defaultTest?.assert ?? []).map((a) => a.value),
    ].filter((v): v is string => typeof v === "string" && v.startsWith("file://"));

    expect(
      refs.length,
      "the config should reference the prompt, tools and golden set by file://",
    ).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(existsSync(resolveFileRef(ref)), `missing file referenced by config: ${ref}`).toBe(
        true,
      );
    }
  });

  it("grades tool selection with code, not a judge, by default", () => {
    const asserts = readConfig().defaultTest?.assert ?? [];
    const types = asserts.map((a) => a.type);
    expect(
      types,
      "every case gets the deterministic tool-selection grader (issue #264 success criterion 2)",
    ).toContain("javascript");
    expect(types, "no llm-rubric may be applied to every case").not.toContain("llm-rubric");
  });
});

describe("golden set", () => {
  it("holds a number of tasks inside the PRD's 20–50 window", () => {
    const cases = allCases(readConfig());
    expect(cases.length, `at least ${MIN_CASES} cases (issue #264 target)`).toBeGreaterThanOrEqual(
      MIN_CASES,
    );
    expect(cases.length, `at most ${MAX_CASES} cases`).toBeLessThanOrEqual(MAX_CASES);
  });

  it("balances positive and negative cases against a floor proportional to the suite", () => {
    const cases = allCases(readConfig());
    const floor = polarityFloor(cases.length);
    const byPolarity = (p: Polarity) => cases.filter((c) => c.metadata?.polarity === p);
    expect(byPolarity("positive").length, `positive cases (floor ${floor})`).toBeGreaterThanOrEqual(
      floor,
    );
    expect(byPolarity("negative").length, `negative cases (floor ${floor})`).toBeGreaterThanOrEqual(
      floor,
    );
    expect(byPolarity("positive").length + byPolarity("negative").length).toBe(cases.length);
  });

  it("scales the polarity floor with the suite, so growth cannot dilute one side", () => {
    // At the bottom of the window the proportional floor is close to the old
    // absolute 5; at the top it is three times it.
    expect(polarityFloor(MIN_CASES)).toBe(6);
    expect(polarityFloor(MAX_CASES)).toBe(15);
    // The discriminating split: 34 positive / 6 negative at 40 cases cleared
    // the old absolute floor of 5 and is rejected by the proportional one.
    expect(6, "a 34/6 split at 40 cases must not pass as balanced").toBeLessThan(polarityFloor(40));
  });

  it("gives every case a description, a scenario, a polarity and a rationale", () => {
    for (const { file, cases } of loadGoldenSet(readConfig())) {
      cases.forEach((testCase, index) => {
        const at = `${file}[${index}]`;
        expect(typeof testCase.description, `${at}: description`).toBe("string");
        expect(String(testCase.description).length, `${at}: description`).toBeGreaterThan(0);
        expect(typeof testCase.vars?.scenario, `${at}: vars.scenario`).toBe("string");
        expect(String(testCase.vars?.scenario).length, `${at}: vars.scenario`).toBeGreaterThan(20);
        expect(POLARITIES, `${at}: metadata.polarity`).toContain(testCase.metadata?.polarity);
        expect(typeof testCase.metadata?.rationale, `${at}: metadata.rationale`).toBe("string");
      });
    }
  });

  it("gives every case a reference solution (expected tools, explicitly empty for a no-tool case)", () => {
    for (const { file, cases } of loadGoldenSet(readConfig())) {
      cases.forEach((testCase, index) => {
        const at = `${file}[${index}]`;
        expect(
          Array.isArray(testCase.metadata?.expected_tools),
          `${at}: metadata.expected_tools must be a list (use [] for "no tool should fire")`,
        ).toBe(true);
        if (testCase.metadata?.polarity === "positive") {
          expect(
            stringList(testCase.metadata?.expected_tools).length,
            `${at}: a positive case must name the tool that should fire`,
          ).toBeGreaterThan(0);
        }
      });
    }
  });

  it("names only tools the MCP server actually registers", () => {
    const known = new Set(registeredToolNames());
    for (const { file, cases } of loadGoldenSet(readConfig())) {
      cases.forEach((testCase, index) => {
        const named = [
          ...stringList(testCase.metadata?.expected_tools),
          ...stringList(testCase.metadata?.forbidden_tools),
          ...stringList(testCase.metadata?.acceptable_tools),
        ];
        for (const tool of named) {
          expect(known, `${file}[${index}] names an unregistered tool: ${tool}`).toContain(tool);
        }
      });
    }
  });

  it("grounds every case in a prompt-surface file that exists", () => {
    for (const { file, cases } of loadGoldenSet(readConfig())) {
      cases.forEach((testCase, index) => {
        const grounded = stringList(testCase.metadata?.grounded_in);
        expect(
          grounded.length,
          `${file}[${index}]: metadata.grounded_in must cite the surface it was drawn from`,
        ).toBeGreaterThan(0);
        for (const path of grounded) {
          expect(existsSync(join(REPO_ROOT, path)), `${file}[${index}]: no such file ${path}`).toBe(
            true,
          );
        }
        // At least one citation must be a surface this suite actually feeds
        // the model (ADR-0083 §8): a case grounded only in SKILL.md or
        // packaging would pass the fast gate while measuring nothing.
        const MEASURED = [
          "apps/mcp/src/instructions.ts",
          "apps/mcp/src/tools.ts",
          "apps/mcp/src/prompts.ts",
          "apps/mcp/src/server.ts",
          "packages/domain/src/",
        ];
        expect(
          grounded.some((path) => MEASURED.some((m) => path.startsWith(m))),
          `${file}[${index}]: grounded_in cites no MEASURED surface — the suite never feeds the model ${grounded.join(", ")}`,
        ).toBe(true);
      });
    }
  });

  it("keeps case descriptions unique", () => {
    const descriptions = allCases(readConfig()).map((c) => String(c.description));
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  // `not-icontains-any` is negation-blind: it matches the substring, not the
  // sentence. On a scenario that asks the model to DESCRIBE the boundary, the
  // correct answer ("it cannot read all reports in your org") contains a
  // forbidden phrase and would be scored a failure. Those cases opt out with
  // `metadata.guard_mode: describe-boundary` — an explicit, greppable field, so
  // the exemption is visible in the data rather than buried in an assertion —
  // and the test below makes them pay for it with a positive requirement.
  it("forbids every OVERCLAIM_PATTERN phrase on every over-claim guard case", () => {
    const guardCases = allCases(readConfig()).filter((c) => c.metadata?.guard === "overclaim");
    expect(guardCases.length, "the suite must probe the over-claim guard").toBeGreaterThanOrEqual(
      3,
    );

    const phrases = overclaimPhrases();
    expect(phrases.length, "OVERCLAIM_PATTERNS expanded to nothing").toBeGreaterThan(0);

    const blocklistCases = guardCases.filter((c) => c.metadata?.guard_mode !== "describe-boundary");
    expect(
      blocklistCases.length,
      "the phrase blocklist must still be exercised by most guard cases",
    ).toBeGreaterThanOrEqual(3);

    blocklistCases.forEach((testCase) => {
      const forbidden = new Set(
        (testCase.assert ?? [])
          .filter((a) => a.type === "not-icontains-any")
          .flatMap((a) => stringList(a.value)),
      );
      for (const phrase of phrases) {
        expect(
          forbidden,
          `over-claim case "${testCase.description}" does not forbid the phrase "${phrase}"`,
        ).toContain(phrase);
      }
    });
  });

  it("makes every describe-boundary exemption pay for itself with a positive requirement", () => {
    const exempt = allCases(readConfig()).filter(
      (c) => c.metadata?.guard === "overclaim" && c.metadata?.guard_mode === "describe-boundary",
    );
    expect(
      exempt.length,
      "the negation-blind exemption must be used, or deleted as dead policy",
    ).toBeGreaterThan(0);

    exempt.forEach((testCase) => {
      // An assert-set groups alternatives (either-passes) — its members count
      // the same as top-level assertions for both checks here.
      const asserts = flattenAsserts(testCase.assert ?? []);
      const at = `describe-boundary case "${testCase.description}"`;
      expect(
        asserts.map((a) => a.type),
        `${at} must not re-apply the negation-blind blocklist it is exempt from`,
      ).not.toContain("not-icontains-any");
      // Exemption from "must not say X" is only safe alongside "must say Y":
      // otherwise the case asserts nothing but the default tool grader.
      const positive = asserts.filter(
        (a) => a.type === "icontains-any" || a.type === "icontains" || a.type === "llm-rubric",
      );
      expect(
        positive.length,
        `${at} must REQUIRE the scoping language (icontains-any / llm-rubric), not merely stop forbidding phrases`,
      ).toBeGreaterThan(0);
    });
  });

  // A typo in an `assert.type` is not an error in promptfoo — an unknown type
  // is a case that quietly grades nothing, which reads as a green suite. The
  // allowlist is the set this repo has verified against the installed
  // promptfoo (see README "Verified assertion types"); widening it is a
  // deliberate edit, not a typo.
  it("uses only assertion types this repo has verified against promptfoo", () => {
    const KNOWN_ASSERT_TYPES = new Set([
      "javascript",
      "llm-rubric",
      "not-icontains-any",
      "icontains",
      "icontains-any",
      "regex",
      "tool-call-f1",
      // Grouping node, verified via `promptfoo validate config`: its nested
      // asserts are flattened below so their types are checked individually.
      "assert-set",
    ]);
    const config = readConfig();
    const declared = flattenAsserts([
      ...(config.defaultTest?.assert ?? []),
      ...allCases(config).flatMap((c) => c.assert ?? []),
    ]);
    expect(declared.length, "the suite must declare assertions").toBeGreaterThan(0);
    for (const assertion of declared) {
      expect(KNOWN_ASSERT_TYPES, `unknown assert type: ${String(assertion.type)}`).toContain(
        assertion.type,
      );
    }
  });

  // The reference solution lives in `metadata.expected_tools`; `tool-call-f1`
  // restates it as an assertion value. Two copies of one fact drift, and the
  // drift is invisible — f1 would grade against a stale list while the code
  // grader graded against the live one.
  it("keeps tool-call-f1 values identical to the case's expected_tools", () => {
    for (const { file, cases } of loadGoldenSet(readConfig())) {
      cases.forEach((testCase, index) => {
        const f1 = (testCase.assert ?? []).filter((a) => a.type === "tool-call-f1");
        if (f1.length === 0) return;
        const expectedTools = stringList(testCase.metadata?.expected_tools);
        for (const assertion of f1) {
          const value = Array.isArray(assertion.value)
            ? stringList(assertion.value)
            : String(assertion.value)
                .split(",")
                .map((s) => s.trim());
          expect(
            [...value].sort(),
            `${file}[${index}]: tool-call-f1 value disagrees with metadata.expected_tools`,
          ).toEqual([...expectedTools].sort());
        }
      });
    }
  });

  it("keeps LLM judging to a minority of cases, on a different model than the generator", () => {
    const config = readConfig();
    const cases = allCases(config);
    const judged = cases.filter((c) => (c.assert ?? []).some((a) => a.type === "llm-rubric"));
    expect(
      judged.length,
      "LLM-as-judge is for genuinely subjective dimensions only (issue #264 criterion 2)",
    ).toBeLessThanOrEqual(2);

    const generator = config.providers?.[0];
    const generatorId = typeof generator === "string" ? generator : generator?.id;
    for (const testCase of judged) {
      const rubrics = (testCase.assert ?? []).filter((a) => a.type === "llm-rubric") as {
        provider?: string;
        threshold?: number;
      }[];
      for (const rubric of rubrics) {
        expect(rubric.provider, "a judge must be pinned explicitly").toBeTypeOf("string");
        expect(rubric.provider, "the judge must not be the generator model").not.toBe(generatorId);
        expect(rubric.threshold, "a judge needs an explicit score threshold").toBeTypeOf("number");
      }
    }
  });
});

describe("tool annotations reach the model (ADR-0051 hints)", () => {
  it("captures the title and annotations every registration sets", () => {
    const tools = captureRegisteredTools();
    expect(tools.length, "the MCP server must register tools").toBeGreaterThan(0);
    for (const tool of tools) {
      expect(typeof tool.title, `${tool.name}: title`).toBe("string");
      expect(tool.title.length, `${tool.name}: title must not be empty`).toBeGreaterThan(0);
      expect(
        typeof tool.annotations.readOnlyHint,
        `${tool.name}: readOnlyHint must be set deliberately (SDK defaults assume destructive)`,
      ).toBe("boolean");
      expect(typeof tool.annotations.destructiveHint, `${tool.name}: destructiveHint`).toBe(
        "boolean",
      );
    }
  });

  it("projects the destructive hint into the description the model actually sees", () => {
    // Anthropic tool definitions carry no annotations field, so a hint that is
    // not written into the description is a hint the model never receives —
    // and a negative case leaning on it would be testing something that does
    // not ship.
    const destroyer = captureRegisteredTools().find((t) => t.name === "reports_delete");
    expect(destroyer, "reports_delete must be registered").toBeDefined();
    expect(destroyer?.annotations.destructiveHint).toBe(true);

    const wire = toolsForProvider().find((t) => t.name === "reports_delete");
    expect(wire?.description, "the destructive hint must be visible on the wire").toMatch(
      /destructive/i,
    );
  });

  it("projects the read-only hint too, and never marks a read tool destructive", () => {
    // Match the projected marker, not the word "read-only" — several read tool
    // descriptions already say "Read-only." in prose, so a looser assertion
    // would pass with the projection removed.
    const wire = toolsForProvider().find((t) => t.name === "reports_get");
    expect(wire?.description).toMatch(/Tool safety hints: read-only \(makes no changes\)\./);
    expect(wire?.description).not.toMatch(/DESTRUCTIVE/);
  });
});

describe("generated fixtures", () => {
  it("pins the instructions fixture to the shipped INSTRUCTIONS constant", () => {
    const fixture = join(EVALS_DIR, "fixtures", "instructions.txt");
    expect(existsSync(fixture), `${fixture} must exist — run pnpm evals:sync`).toBe(true);
    expect(
      readFileSync(fixture, "utf8").trimEnd(),
      "instructions fixture is stale — run pnpm evals:sync",
    ).toBe(INSTRUCTIONS);
  });

  it("pins the tool fixture to the live tool registrations", () => {
    const fixture = join(EVALS_DIR, "fixtures", "mcp-tools.json");
    expect(existsSync(fixture), `${fixture} must exist — run pnpm evals:sync`).toBe(true);
    expect(
      JSON.parse(readFileSync(fixture, "utf8")),
      "tool fixture is stale — run pnpm evals:sync",
    ).toEqual(toolsForProvider());
  });
});
