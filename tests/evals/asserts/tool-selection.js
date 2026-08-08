// The CODE grader for tool selection (issue #264 success criterion 2: tool
// selection is code-graded, never LLM-judged).
//
// It reads the reference solution off the case's `metadata` and scores the
// OUTCOME, not the path:
//
//   coverage (0.6) — did the tool(s) that should fire, fire? `expected_any_of`
//                    turns the set into "at least one of these is right", which
//                    is how a case with two defensible answers is expressed.
//                    For a no-tool case (`expected_tools: []`) coverage is 1
//                    exactly when nothing outside `acceptable_tools` fired.
//   restraint (0.2) — nothing forbidden fired, and nothing fired that is
//                    neither expected nor explicitly acceptable. Reading a
//                    folder list before moving a report is not a mistake, so
//                    `acceptable_tools` costs nothing; calling `reports_delete`
//                    when asked to confirm first does.
//   arguments (0.2) — the reference ARG SHAPE, not exact values: which keys
//                    must be present, which must be absent, which must equal a
//                    specific enum member.
//
// Partial credit is the point — a run that scores 0.8 on "called the right
// tool but omitted update_slug" is a different failure from one that scored 0,
// and the reason string says which. `metadata.min_score` (default 1) is the
// per-case bar.

/**
 * Every `{…}` run in `text` whose braces balance, outermost-first.
 *
 * String-aware (a `{` inside a JSON string value must not open a run, and an
 * escaped quote must not close the string) so a description containing a brace
 * cannot desync the depth count. Cheap and approximate on purpose: whatever it
 * returns is handed to `JSON.parse`, which is the real arbiter.
 */
function balancedJsonRuns(text) {
  const runs = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}") {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          runs.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return runs;
}

/** Pull every `tool_use` block out of whatever shape the provider returned. */
function extractToolCalls(output) {
  const calls = [];

  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value.type === "tool_use" && typeof value.name === "string") {
      calls.push({ name: value.name, input: value.input ?? {} });
      return;
    }
    if (Array.isArray(value.content)) visit(value.content);
    if (Array.isArray(value.tool_calls)) visit(value.tool_calls);
  };

  if (typeof output === "string") {
    // Whole-document first: an output that is itself one JSON value (a raw
    // message envelope, or a single pretty-printed block) parses here and the
    // line scan below would never see it — every brace sits on its own line.
    const trimmedAll = output.trim();
    if (trimmedAll.startsWith("{") || trimmedAll.startsWith("[")) {
      try {
        visit(JSON.parse(trimmedAll));
        if (calls.length > 0) return calls;
      } catch {
        // Not a single JSON document — fall through to the line scan.
      }
    }

    // The Anthropic provider renders a tool-using turn as the text blocks plus
    // one JSON-stringified block per non-text block, joined by blank lines.
    // Each block is normally on ONE line, which is what the line scan handles.
    for (const line of output.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) continue;
      try {
        visit(JSON.parse(trimmed));
      } catch {
        // Prose that merely looks like JSON — not a tool call.
      }
    }
    if (calls.length > 0) return calls;

    // Last resort: prose interleaved with a PRETTY-PRINTED block, so neither
    // path above sees it. Scan for balanced brace runs and try each one.
    // Deliberately last — it is the loosest reader, and failing OPEN here
    // (reporting "no tools called") would score a negative case as a pass,
    // which is the one direction this grader must never fail in.
    for (const candidate of balancedJsonRuns(output)) {
      try {
        visit(JSON.parse(candidate));
      } catch {
        // Braces that balance but are not JSON.
      }
    }
    return calls;
  }

  visit(output);
  return calls;
}

function asList(value) {
  return Array.isArray(value) ? value.map(String) : [];
}

/** Score the reference arg shape for one tool. Returns [satisfied, total, notes]. */
function scoreArgs(spec, calls) {
  const required = asList(spec.required);
  const forbidden = asList(spec.forbidden);
  const equals = spec.equals && typeof spec.equals === "object" ? spec.equals : {};
  const checks = required.length + forbidden.length + Object.keys(equals).length;
  if (checks === 0) return [0, 0, []];

  // Grade against the best-matching call, so a retry inside one turn is not
  // punished for the first attempt.
  let best = { satisfied: -1, notes: [] };
  for (const call of calls) {
    const input = call.input && typeof call.input === "object" ? call.input : {};
    const notes = [];
    let satisfied = 0;
    for (const key of required) {
      if (input[key] !== undefined && input[key] !== null && input[key] !== "") satisfied += 1;
      else notes.push(`${call.name} is missing required arg \`${key}\``);
    }
    for (const key of forbidden) {
      if (input[key] === undefined) satisfied += 1;
      else notes.push(`${call.name} passed \`${key}\`, which this scenario must not set`);
    }
    for (const [key, want] of Object.entries(equals)) {
      if (input[key] === want) satisfied += 1;
      else
        notes.push(
          `${call.name}.${key} is ${JSON.stringify(input[key])}, expected ${JSON.stringify(want)}`,
        );
    }
    if (satisfied > best.satisfied) best = { satisfied, notes };
  }
  return [Math.max(best.satisfied, 0), checks, best.notes];
}

export default function gradeToolSelection(output, context) {
  const metadata = context?.test?.metadata ?? {};
  const expected = asList(metadata.expected_tools);
  const forbidden = asList(metadata.forbidden_tools);
  const acceptable = asList(metadata.acceptable_tools);
  const expectedArgs = metadata.expected_args ?? {};
  const anyOf = metadata.expected_any_of === true;
  const minScore = typeof metadata.min_score === "number" ? metadata.min_score : 1;

  const calls = extractToolCalls(output);
  const called = [...new Set(calls.map((c) => c.name))];
  const allowed = new Set([...expected, ...acceptable]);
  const hit = expected.filter((tool) => called.includes(tool));
  const unexpected = called.filter((tool) => !allowed.has(tool));
  const forbiddenHit = called.filter((tool) => forbidden.includes(tool));

  const reasons = [];

  // --- coverage -------------------------------------------------------------
  let coverage;
  if (expected.length === 0) {
    coverage = unexpected.length === 0 ? 1 : 0;
    if (coverage === 0) reasons.push(`no tool should have fired, but ${unexpected.join(", ")} did`);
  } else if (anyOf) {
    coverage = hit.length > 0 ? 1 : 0;
    if (coverage === 0)
      reasons.push(
        `expected any of [${expected.join(", ")}]; called [${called.join(", ") || "none"}]`,
      );
  } else {
    coverage = hit.length / expected.length;
    const missed = expected.filter((tool) => !called.includes(tool));
    if (missed.length > 0) reasons.push(`did not call ${missed.join(", ")}`);
  }

  // --- restraint ------------------------------------------------------------
  let restraint = 1;
  if (forbiddenHit.length > 0) {
    restraint = 0;
    reasons.push(`called forbidden tool(s) ${forbiddenHit.join(", ")}`);
  } else if (expected.length > 0 && unexpected.length > 0) {
    restraint = 0.5;
    reasons.push(`called unrelated tool(s) ${unexpected.join(", ")}`);
  }

  // --- argument shape -------------------------------------------------------
  let argsSatisfied = 0;
  let argsChecked = 0;
  for (const [tool, spec] of Object.entries(expectedArgs)) {
    const toolCalls = calls.filter((c) => c.name === tool);
    if (toolCalls.length === 0) continue; // already penalised by coverage
    const [satisfied, checks, notes] = scoreArgs(spec ?? {}, toolCalls);
    argsSatisfied += satisfied;
    argsChecked += checks;
    reasons.push(...notes);
  }
  const args = argsChecked === 0 ? 1 : argsSatisfied / argsChecked;

  const score = 0.6 * coverage + 0.2 * restraint + 0.2 * args;
  const pass = score + 1e-9 >= minScore;

  return {
    pass,
    score,
    reason: pass
      ? `tool selection ok (score ${score.toFixed(2)}); called [${called.join(", ") || "none"}]`
      : `score ${score.toFixed(2)} < ${minScore}: ${reasons.join("; ") || "no reason recorded"}`,
  };
}
