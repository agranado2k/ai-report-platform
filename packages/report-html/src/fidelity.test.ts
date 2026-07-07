import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBody, serializeBody } from "./body.js";
import { CHIP_VARIANTS } from "./schema/chip.js";
import { reinjectShell, splitShell } from "./shell.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, "./fixtures/ai-readiness-report.html");
const loadFixtureHtml = () => readFileSync(FIXTURE_PATH, "utf-8");

function extractClasses(html: string): string[] {
  const classes: string[] = [];
  const re = /class="([^"]*)"/g;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex-exec loop
  while ((m = re.exec(html))) {
    for (const c of (m[1] ?? "").split(/\s+/).filter(Boolean)) classes.push(c);
  }
  return classes;
}

function countClasses(html: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of extractClasses(html)) counts.set(c, (counts.get(c) ?? 0) + 1);
  return counts;
}

/**
 * The 15 bespoke fixture classes ADR-0062's decision record scores fidelity
 * against (spike's L1 generic-retention schema got 13/15 zero-delta, with
 * `chip` itself — counted once here as a family, not per-variant — among
 * the 2 losses because L1 had no dedicated chip mark yet; see the 9-variant
 * check separately below).
 */
const BESPOKE_CLASSES = [
  "chip",
  "card",
  "checklist",
  "resrow",
  "resgroup",
  "sec",
  "secnum",
  "pill",
  "kbd",
  "desc",
  "rmeta",
  "rtags",
  "rt",
  "rd",
  "ref",
] as const;

describe("round-trip fidelity suite (ADR-0062) — split shell -> parse body -> serialize -> reinject", () => {
  const original = loadFixtureHtml();
  const { shell, bodyHtml } = splitShell(original);
  const doc = parseBody(bodyHtml);
  const roundtrippedBody = serializeBody(doc);
  const reinjected = reinjectShell(shell, roundtrippedBody);

  it("(c) reinjects into a shell that is byte-identical to the original document's shell", () => {
    const reparsed = splitShell(reinjected);
    expect(reparsed.shell.pre).toBe(shell.pre);
    expect(reparsed.shell.post).toBe(shell.post);
    // The shell itself was never touched by parse/serialize, so it must
    // still be exactly the slice captured off the untouched original.
    expect(shell.pre + shell.post).toBe(original.slice(0, shell.pre.length) + shell.post);
  });

  it("(a) preserves all 15 bespoke fixture class counts (spike's L1 got 13/15)", () => {
    const origCounts = countClasses(bodyHtml);
    const gotCounts = countClasses(roundtrippedBody);

    const report = BESPOKE_CLASSES.map((c) => ({
      class: c,
      original: origCounts.get(c) ?? 0,
      roundtripped: gotCounts.get(c) ?? 0,
      delta: (gotCounts.get(c) ?? 0) - (origCounts.get(c) ?? 0),
    }));

    // eslint-disable-next-line no-console
    console.table(report);

    for (const row of report) {
      expect(row.original, `"${row.class}" had 0 occurrences in the fixture`).toBeGreaterThan(0);
      expect(row.delta, `"${row.class}": ${row.original} -> ${row.roundtripped}`).toBe(0);
    }
  });

  it("(d) parses and round-trips all 9 chip variants in the enum", () => {
    expect(CHIP_VARIANTS).toHaveLength(9);

    const origCounts = countClasses(bodyHtml);
    const gotCounts = countClasses(roundtrippedBody);

    for (const variant of CHIP_VARIANTS) {
      const className = `chip-${variant}`;
      const originalCount = origCounts.get(className) ?? 0;
      expect(originalCount, `"${className}" had 0 occurrences in the fixture`).toBeGreaterThan(0);
      expect(gotCounts.get(className) ?? 0).toBe(originalCount);
    }
  });

  it("(b) thead/tbody survive on both fixture tables (the spike's known gap)", () => {
    expect((bodyHtml.match(/<thead>/g) ?? []).length).toBe(2);
    expect((bodyHtml.match(/<tbody>/g) ?? []).length).toBe(2);
    expect((roundtrippedBody.match(/<thead>/g) ?? []).length).toBe(2);
    expect((roundtrippedBody.match(/<tbody>/g) ?? []).length).toBe(2);
  });

  it("parses without throwing and produces non-trivial output", () => {
    expect(roundtrippedBody.length).toBeGreaterThan(1000);
    expect(reinjected).toContain("<style>");
    expect(reinjected).toContain("Executive summary");
  });
});
