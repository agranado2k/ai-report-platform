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
import { INSTRUCTIONS, overclaimPhrases, registeredToolNames, toolsForProvider } from "./surface";

const EVALS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(EVALS_DIR, "..", "..");

const CONFIG_PATH = join(EVALS_DIR, "promptfooconfig.yaml");

const POLARITIES = ["positive", "negative"] as const;
type Polarity = (typeof POLARITIES)[number];

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
  };
  assert?: { type?: unknown; value?: unknown }[];
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
  it("holds a seeded, growable number of tasks", () => {
    const cases = allCases(readConfig());
    // The issue targets 20–50 grown from REAL observed failures; this repo
    // seeds 15–25 and grows the rest from CI failures (see README.md).
    expect(cases.length).toBeGreaterThanOrEqual(15);
    expect(cases.length).toBeLessThanOrEqual(50);
  });

  it("balances positive and negative cases", () => {
    const cases = allCases(readConfig());
    const byPolarity = (p: Polarity) => cases.filter((c) => c.metadata?.polarity === p);
    expect(byPolarity("positive").length, "positive cases").toBeGreaterThanOrEqual(5);
    expect(byPolarity("negative").length, "negative cases").toBeGreaterThanOrEqual(5);
    expect(byPolarity("positive").length + byPolarity("negative").length).toBe(cases.length);
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
      });
    }
  });

  it("keeps case descriptions unique", () => {
    const descriptions = allCases(readConfig()).map((c) => String(c.description));
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it("forbids every OVERCLAIM_PATTERN phrase on every over-claim guard case", () => {
    const guardCases = allCases(readConfig()).filter((c) => c.metadata?.guard === "overclaim");
    expect(guardCases.length, "the suite must probe the over-claim guard").toBeGreaterThanOrEqual(
      3,
    );

    const phrases = overclaimPhrases();
    expect(phrases.length, "OVERCLAIM_PATTERNS expanded to nothing").toBeGreaterThan(0);

    guardCases.forEach((testCase) => {
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
