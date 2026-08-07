# `tests/evals` — the prompt-eval tier

**Evals are our TDD for the prompts.** `apps/mcp`'s product surface *is* prompt
text (ADR-0072): the server `instructions` string, 27 tool descriptions, and the
packaged skill. A one-line edit to any of them can move agent behaviour
dramatically, and until this tier existed nothing in the repo would catch it —
only `OVERCLAIM_PATTERNS`, a regex over our own source, which can prove we did
not *write* an over-claim but says nothing about what a model *does* with the
text we did write.

Decision record: [ADR-0083](../../docs/adr/0083-prompt-evals-promptfoo.md).
PRD: issue #264.

## Two tiers, one of which costs money

| Tier | What it proves | Needs a key? | Runs in |
| --- | --- | --- | --- |
| **Smoke** (`golden-set.test.ts`, `asserts/tool-selection.test.ts`) | The harness is well-formed: the config parses, every `file://` it names exists, every case carries a reference solution, the generated tool fixture still matches the live `apps/mcp` registrations, and the grader itself behaves | **No** | `pnpm test` — the ordinary fast gate |
| **Eval** (`promptfooconfig.yaml`) | The shipped prompt surface produces the right agent behaviour | **Yes** | `.github/workflows/prompt-evals.yml`, path-scoped to the prompt surfaces |

The smoke tier deliberately asserts nothing about model behaviour. Faking
behavioural coverage in the keyless tier would be exactly the "make the test ask
for less" failure mode ADR-0081 exists to detect.

## Running it

```bash
pnpm test                 # the keyless smoke tier (already part of the normal gate)
pnpm evals:validate       # parse + validate the promptfoo config — no key, no spend
pnpm evals:sync           # regenerate fixtures/ from apps/mcp/src
pnpm evals                # the real thing: needs ANTHROPIC_API_KEY, spends money
```

`pnpm evals` runs `promptfoo eval --repeat 3` (see **pass^k** below). To iterate
on one case while authoring, add `--filter-pattern "<part of the description>"`.

> **Node**: promptfoo requires Node ≥ 22.22. CI runs Node 24. If `pnpm evals`
> refuses to start, that is why — the rest of the repo is happy on Node 20+.

## Layout

```
promptfooconfig.yaml      the suite: provider, prompt, default assertions, test globs
golden-set/
  tool-selection.yaml           positive cases — the right tool should fire
  tool-selection-negative.yaml  negative cases — nothing (or nothing destructive) should fire
  overclaim-guard.yaml          does the model claim reach it does not have?
prompts/mcp-client.js     system = the shipped `instructions`, user = the scenario
asserts/tool-selection.js the CODE grader: outcomes, partial credit, no LLM
fixtures/
  instructions.txt        generated from apps/mcp/src/instructions.ts
  mcp-tools.json          generated from apps/mcp/src/tools.ts (27 tool definitions)
  build-fixtures.ts       what `pnpm evals:sync` runs
  sync-fixtures.mjs       the esbuild bundle step that lets it reach apps/mcp's deps
surface.ts                the single seam both tiers read the real surfaces through
```

**Nothing in `fixtures/` is hand-edited.** They are generated, checked in (so the
CI eval job needs no build step), and pinned by the smoke tier — so an edit to
`instructions.ts` or `tools.ts` that skips `pnpm evals:sync` fails `pnpm test`,
and the regenerated diff makes the prompt-surface change reviewable in the PR.

## Anatomy of a case

Each entry is an ordinary promptfoo test case; everything the grader needs lives
under `metadata`, and the shape is enforced by `golden-set.test.ts`.

```yaml
- description: republish under the same slug so the shared link survives
  vars:
    scenario: >-
      I regenerated the Q3 revenue report. Publish the new version to the report
      with slug `q3-revenue` — I already emailed that link to the client…
  metadata:
    polarity: positive          # positive | negative — required, and balanced across the suite
    expected_tools: [reports_upload]   # the reference solution; [] means "nothing should fire"
    expected_any_of: false      # true ⇒ "any one of expected_tools is correct"
    acceptable_tools: []        # legitimate lookups on the way; never penalised
    forbidden_tools: []         # calling one of these zeroes the restraint component
    expected_args:              # the reference ARG SHAPE, not exact values
      reports_upload:
        required: [html, update_slug]
        forbidden: []
        equals: {}
    min_score: 1                # optional; the per-case bar (default 1.0)
    grounded_in:                # the shipped file(s) this was drawn from — must exist
      - apps/mcp/src/instructions.ts
    rationale: >-
      Why this case exists and what breaks if it goes red.
  assert:
    - type: tool-call-f1        # optional, on top of the default code grader
      value: [reports_upload]
      threshold: 1
```

### How grading works

`asserts/tool-selection.js` runs on **every** case and scores the *outcome*, not
the path, with partial credit:

| Component | Weight | Question |
| --- | --- | --- |
| coverage | 0.6 | did the tool(s) that should fire, fire? (or, for a no-tool case, did nothing fire?) |
| restraint | 0.2 | nothing forbidden, nothing unrelated |
| arguments | 0.2 | the reference arg shape — required keys present, forbidden keys absent, enums equal |

Partial credit is the point: 0.9 ("right tool, missing `update_slug`") and 0.4
("never called it") are different failures, and the `reason` string says which.

Tool selection is **code-graded, never LLM-judged** (issue #264 criterion 2).
`tool-call-f1` is layered on the cases with exactly one defensible answer.

`llm-rubric` is used on **exactly one** case — "explain the trust boundary for a
security review" — because "is this paragraph's description of the boundary
accurate?" genuinely cannot be decided by string matching. It follows the
constrained-judge rules: one isolated dimension, an explicit `threshold: 0.8`, a
"return Unknown" escape hatch, and **a different model from the generator**
(`claude-haiku-4-5` judging `claude-sonnet-5`). The smoke tier enforces all
three, and caps LLM-judged cases at two.

### Verified assertion types

Checked against the installed promptfoo (0.122.0), not assumed:

- `tool-call-f1` — **available**. `value` is a list of tool names (or a
  comma-separated string), `threshold` defaults to 1, score is the unordered F1
  of called vs expected. Its extractor understands the Anthropic provider's
  stringified `tool_use` blocks.
- `is-valid-function-call` — **not usable here.** It delegates to the provider's
  `validateFunctionToolCall`, which the Anthropic provider does not implement;
  it fails with "Provider does not have functionality for checking function
  call" regardless of the output. The `javascript` grader covers what it would
  have.
- `regex` compiles with **no flags**, so it cannot carry the `/i` on
  `OVERCLAIM_PATTERNS`. The over-claim cases use `not-icontains-any` over the
  phrases those patterns expand to — mechanically derived in `surface.ts` and
  pinned per-case by the smoke tier, so a new pattern in `instructions.ts` fails
  the fast gate until the golden set grows with it.

## pass^k — the consistency gate

`--repeat 3`. promptfoo runs every case k times and the job fails if **any**
trial fails, which is pass^3: a case only counts as passing if it passes all
three times. Three, not ten, because the suite is a per-PR gate and cost scales
linearly with k; raise it if flaky cases start slipping through. Note that the
response cache is namespaced per repeat index, so the k trials are genuinely
independent samples rather than one call replayed.

## Growing the set — from real failures, not imagination

The suite seeds **25 cases** (13 positive / 12 negative). The issue's target is
20–50 **drawn from real observed failures** (Anthropic's own guidance, not the
100–200 of secondary blogs), and the remaining headroom is deliberately unspent:
a case invented at a desk measures our imagination, a case harvested from a
failure measures the product.

When a prompt-surface change makes an agent do the wrong thing — in CI, in
dogfooding, in a bug report:

1. **Reproduce it as a scenario.** One user turn, in the user's own words. Do
   not sanitise it into the phrasing that makes the right tool obvious.
2. **Add it to the right file** — `tool-selection.yaml` if a tool should fire,
   `tool-selection-negative.yaml` if nothing (or nothing destructive) should,
   `overclaim-guard.yaml` if it is about claimed reach.
3. **Write the reference solution** (`expected_tools` + `expected_args`) and
   `grounded_in` — the shipped file that *should* have prevented it. If you
   cannot name one, the fix is a prompt edit, not just a new case.
4. **Write `rationale` as the failure you saw**, not a restatement of the case.
5. **Watch it go red**, then fix the surface, then watch it go green. Same loop
   as `/tdd`.
6. `pnpm test` to check the schema, `pnpm evals:validate` to check the config.

**Saturation review.** A suite at 100% is a regression gate, not a research
tool. When every case has passed for several consecutive prompt-surface PRs,
that is a signal to harvest harder cases — not a signal that the surface is
finished.

## Cost

Per full run: 25 cases × k repeats × 1 request, plus one judge call per repeat
on the single rubric case. At `--repeat 3` that is 75 generator calls and 3
judge calls, on a ~1k-token system prompt plus ~9k tokens of tool definitions,
with short outputs. Controls:

- **Response caching is on by default** (14-day TTL). CI persists
  `.promptfoo-cache/` between runs with `actions/cache`, so a PR that does not
  change the prompt surface re-runs mostly from cache. Any change to the
  instructions, a tool description, the model, or the provider config changes
  the cache key and re-bills — which is correct: that is exactly when the eval
  needs to actually run.
- **Path-scoped triggering.** The workflow only runs on PRs touching
  `apps/mcp/src/instructions.ts`, `apps/mcp/src/tools.ts`, `apps/mcp/src/prompts.ts`,
  `apps/mcp/skill/**`, `apps/mcp/packaging/**`, or `tests/evals/**`.
- **A cheap generator and a cheaper judge**, both recorded in ADR-0083 as
  defaults pending the operator's provider call.

## The pending blocker

CI needs `ANTHROPIC_API_KEY` in repo secrets. Repo secrets are **Terraform-managed**
(the Phase 0b pattern, like `GEMINI_API_KEY`), so provisioning it is an
`infra/terraform` change plus a real key and a budget — an operator decision
that is explicitly still open (issue #264, ADR-0083 §"Pending").

Until then the workflow **skips green**: it checks out, installs, runs the
keyless `promptfoo validate config`, emits a GitHub notice explaining what was
skipped and why, and exits 0. It is not in the required-checks path, so nothing
is blocked either way. The day the secret lands, the same workflow starts
evaluating with no further change.
