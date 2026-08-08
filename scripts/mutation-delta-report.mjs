#!/usr/bin/env node
// mutation-delta-report.mjs — turn one Stryker JSON report into the lines a
// reviewer can act on (ADR-0081 §1; the follow-up it lists first).
//
// Usage: node scripts/mutation-delta-report.mjs <path-to-mutation.json>
//
// Called by scripts/mutation-delta.sh, which owns the scoping and the run; this
// half owns the *shape of the answer* and is therefore pure — a file in, text
// out, no git and no Stryker — which is what makes it testable without a
// mutation run (scripts/test/mutation-delta.test.mjs).
//
// The answer has exactly two parts, because a reviewer only ever asks two
// questions: how load-bearing are the tests over the code this branch touched
// (the score), and WHICH behaviour did nothing check (the survivor list, each
// with file:line and the mutator, so it can be opened and read). Killed mutants
// are a number, never a list: they are the part that needs no attention.
//
// Input is the `mutation-testing-report-schema` v1 JSON Stryker's `json`
// reporter emits — `{ files: { <path>: { mutants: [...] } } }`.

import { readFileSync } from "node:fs";

// Stryker's own score arithmetic (mutation-testing-metrics), restated so this
// script needs no dependency on it:
//   detected = killed + timeout      undetected = survived + noCoverage
//   valid    = detected + undetected covered    = detected + survived
// CompileError / RuntimeError are INVALID mutants (a mutant that never ran is
// evidence of nothing) and `Ignored` ones were excluded on purpose; neither
// belongs in a denominator.
// The undetected ones are also exactly the survivor list: a mutant nothing
// killed and a mutant nothing even ran are the same finding for a reviewer —
// "this behaviour is unenforced" — so they share a section, tagged by status.
const UNDETECTED = new Set(["Survived", "NoCoverage"]);

/** A percentage to 2dp, or "n/a" when the denominator is empty. */
function percent(numerator, denominator) {
  return denominator === 0 ? "n/a" : `${((numerator / denominator) * 100).toFixed(2)}%`;
}

/** Mutators can replace a statement with real source; keep one mutant per line. */
function flatten(replacement, max = 60) {
  const one = String(replacement ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

export function summarize(report) {
  const files = Object.entries(report.files ?? {});
  const counts = { Killed: 0, Timeout: 0, Survived: 0, NoCoverage: 0, other: 0 };
  const survivors = [];

  for (const [path, file] of files) {
    for (const m of file.mutants ?? []) {
      if (m.status in counts) counts[m.status] += 1;
      else counts.other += 1;
      if (!UNDETECTED.has(m.status)) continue;
      const line = m.location?.start?.line ?? 0;
      const column = m.location?.start?.column ?? 0;
      survivors.push({
        path,
        line,
        column,
        status: m.status,
        where: `${path}:${line}:${column}`,
        mutator: m.mutatorName,
        replacement: flatten(m.replacement),
      });
    }
  }

  // Stryker emits mutants in generation order, which interleaves lines. The
  // survivor list is a READING list — it has to follow the file the reviewer
  // opens, top to bottom.
  survivors.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column);

  const detected = counts.Killed + counts.Timeout;
  const valid = detected + counts.Survived + counts.NoCoverage;
  const covered = detected + counts.Survived;

  // The tally reports the score's own denominator, not the raw mutant count.
  // Folding the invalid and ignored mutants into one "N mutants" total made the
  // two numbers irreconcilable — the total silently exceeded the denominator the
  // percentage was computed over, which reads as a bug in the score.
  const unscored = counts.other > 0 ? `, ${counts.other} not scored (invalid or ignored)` : "";

  const lines = [
    "## Score",
    `  ${percent(detected, valid)} total · ${percent(detected, covered)} covered — ` +
      `${counts.Killed} killed, ${counts.Timeout} timeout, ${counts.Survived} survived, ` +
      `${counts.NoCoverage} no-coverage (${valid} scored across ${files.length} file(s)${unscored})`,
    "",
    `## Survivors (${survivors.length})`,
  ];

  if (survivors.length === 0) {
    lines.push("  None — every mutant in the scoped files was killed.");
  } else {
    // Aligned columns: the reviewer scans the `where` column, so it must not
    // jitter with the length of the status word.
    const width = Math.max(...survivors.map((s) => s.status.length));
    for (const s of survivors) {
      lines.push(
        `  ${s.status.padEnd(width)}  ${s.where}  ${s.mutator} → ${s.replacement}`.trimEnd(),
      );
    }
    lines.push("");
    lines.push(
      "  Each line is behaviour the branch's tests do not enforce: Stryker made that",
      "  change and no test failed. Two legitimate answers (ADR-0081 §1) — strengthen",
      "  the test, or state why the mutant is equivalent and cannot be killed.",
    );
  }

  return `${lines.join("\n")}\n`;
}

const path = process.argv[2];
if (!path) {
  process.stderr.write("usage: mutation-delta-report.mjs <path-to-mutation.json>\n");
  process.exit(2);
}
process.stdout.write(summarize(JSON.parse(readFileSync(path, "utf8"))));
