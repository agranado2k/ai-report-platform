# ADR-0083: Prompt evals with promptfoo — the test tier for the agent-facing surfaces

- **Status**: Accepted (2026-08-07) — AI-SDLC Phase 4 (issue #264). The suite and the CI wiring ship in this PR; the **provider/API-key decision is deliberately left open** (see "Pending" below), and the workflow skips green until it is made.
- **Date**: 2026-08-07
- **Deciders**: agranado2k
- **Relates to / extends**: makes ADR-0072's three onboarding layers testable; supplies the missing target function `apps/mcp/CLAUDE.md` §5 promised; sits beside ADR-0042 (Vitest node tier), ADR-0079 (browser tier) and ADR-0019 (e2e tier) as a fourth, non-deterministic tier; applies ADR-0081's "measure whether the target function is load-bearing" reasoning to prompts; enforces the ADR-0069/0059/0060 trust boundary behaviourally rather than only lexically. CI triggering follows the ADR-026 docs-trigger-matrix pattern.

## Context and problem statement

This repo's own constitution requires "tests **and evals** when there is any AI
prompt". It had the first half and not the second.

`apps/mcp` is not a service with an incidental prompt attached — its **product
surface is prompt text**. ADR-0072 defines three layers of it: the server
`instructions` string, 27 tool descriptions, the canonical `SKILL.md`, and the
per-host packaging copies. `apps/mcp/CLAUDE.md` already states the consequence —
"everything a host agent reads is shipped behavior, not documentation… treat
these as source code under test" — and then admits the tier does not exist, so
"this surface carries more human review, not less".

The only automated guard was `OVERCLAIM_PATTERNS`: three regexes asserting our
own strings never say "any user / all reports / every org". That is a real
guard, and it is the wrong shape for the risk. It proves we did not *write* an
over-claim. It cannot observe what a model *does* with the text we did write.
Nothing at all watched the far larger surface — which tool a competent agent
picks when a user says "make the reports in that folder viewable by my org", or
whether it re-uploads to the same slug instead of creating a second report and
silently breaking a link that is already in a customer's inbox.

Concretely: `reports_set_sharing` and `reports_set_acl` overlap; `folders_share`
shares a folder's *name* while `folders_apply_sharing_to_reports` reaches the
reports inside; `reports_resolve_comment` and `reports_delete_comment` take the
same two arguments. In every one of those pairs the *description text is the
only thing that separates them*. Sharpening one sentence to fix one failure can
create another, and today the whole regression surface is a human reading a
diff.

## Decision drivers

- **Evals are TDD for prompts, and must feel like it.** Red on a real failure,
  green after a wording fix, cheap to add a case, runs in CI. A tier that is
  hard to add to will not be added to.
- **Non-determinism is the tier's defining property**, not an inconvenience. A
  single pass proves nothing; the gate has to speak about consistency.
- **Code-graded where code can grade.** Tool selection has a right answer.
  Handing it to a judge model would replace a deterministic signal with a
  correlated one, and make failures unattributable.
- **Judges are a last resort and must be constrained** when used: one isolated
  dimension, a structured rubric, an explicit threshold, an "Unknown" escape
  hatch, and a different model from the generator.
- **Cost has to be bounded by construction**, not by discipline — this is the
  only gate in the repo that spends money per run.
- **A blocked dependency must not block the work.** The provider key is an
  operator decision with a budget attached; the suite, the harness and the
  wiring should land and be exercisable without it.
- **Grounded in the shipped text.** A golden set written from a generic mental
  model of "an MCP server" measures our imagination. It has to be derived from
  the actual `instructions.ts` / `tools.ts` / `SKILL.md`, and it has to *keep*
  being derived from them as they change.

## Considered options

- **Do nothing; keep `OVERCLAIM_PATTERNS` and human review.** Rejected. It is
  the status quo the PRD was written against, it scales with reviewer attention
  rather than with the surface, and it is silent on the entire tool-selection
  surface — which is 27 descriptions and growing.
- **Extend the deterministic regex guard.** Rejected as a category error: no
  regex over our own source can answer "given this text, what does the model
  do". More patterns would raise confidence without raising coverage.
- **Hand-roll an eval harness on top of Vitest** (call the API in a `*.test.ts`,
  assert on the response). Rejected. It looks cheap and then is not: repeats,
  response caching, per-assertion scoring, judge providers, cost accounting and
  a readable failure report are all things promptfoo already has, and a bespoke
  harness would make every one of them a bespoke decision.
- **`evalite`** (Vitest-native, by Matt Pocock). Attractive for local authoring —
  it would sit inside the existing tier rather than beside it — but it is still
  beta and has no CI story comparable to promptfoo's exit codes and caching.
  Revisit for local authoring once it is out of beta; the golden set is
  declarative YAML and would port.
- **promptfoo as the CI backbone.** Chosen. Declarative YAML config, CI exit
  codes, `--repeat` for consistency gating, response caching with a TTL,
  first-class Anthropic provider with tool definitions, and a `tool-call-f1`
  assertion built for exactly this problem.
- **LLM-judge everything.** Rejected outright — see the drivers.

## Decision outcome

**Adopt promptfoo as the prompt-eval backbone, with a code-graded golden set
that is generated from — not merely inspired by — the shipped surfaces.**

### 1. Two tiers, split by whether they cost money

| Tier | Proves | Key? | Runs in |
| --- | --- | --- | --- |
| Smoke (`tests/evals/**/*.test.ts`) | the harness is well-formed and the generated fixtures still match `apps/mcp` | no | `pnpm test`, the ordinary fast gate |
| Eval (`tests/evals/promptfooconfig.yaml`) | the shipped surface produces the right agent behaviour | yes | `.github/workflows/prompt-evals.yml` |

The smoke tier asserts **nothing** about model behaviour. Faking behavioural
coverage in the keyless tier would be precisely the "make the test ask for less"
failure ADR-0081 exists to detect. What it does assert is structural and
load-bearing: the config parses as YAML, every `file://` it names exists, every
case carries a reference solution and a polarity, positive and negative are both
represented, every named tool is one the server actually registers, every
`grounded_in` path exists, and the LLM-judge constraints hold.

### 2. The surfaces are read, not copied

`tests/evals/surface.ts` captures every `server.registerTool(...)` call by
passing `registerReadTools`/`registerWriteTools` a recording stub, and emits the
Anthropic tool definitions from the same zod shapes the real server ships.
`pnpm evals:sync` writes those, plus the `INSTRUCTIONS` constant, into
`tests/evals/fixtures/`. The fixtures are **checked in** — the CI eval job must
run straight from a checkout with no build step, and the fixture diff is how a
prompt-surface edit becomes reviewable in a PR — and **pinned by the smoke
tier**, so editing `instructions.ts` or `tools.ts` without re-syncing fails
`pnpm test`.

The eval's system prompt is therefore the shipped `instructions` string
verbatim, and the model under eval holds the shipped tool descriptions verbatim.
There is no paraphrase anywhere in the loop.

### 3. Outcomes, not paths; partial credit; code-graded

`tests/evals/asserts/tool-selection.js` grades **every** case in code:

| Component | Weight | Question |
| --- | --- | --- |
| coverage | 0.6 | did the tool(s) that should fire, fire? (or, for a no-tool case, did nothing fire?) |
| restraint | 0.2 | nothing forbidden, nothing unrelated |
| arguments | 0.2 | the reference arg *shape* — required keys present, forbidden keys absent, enums equal |

Three properties matter. **Outcomes not paths**: `acceptable_tools` names the
legitimate lookups on the way (reading `folders_list` before `reports_move` is
what the description tells you to do) and they cost nothing, while
`expected_any_of` expresses "two answers are both right". **Partial credit**:
0.9 ("right tool, forgot `update_slug`") and 0.4 ("never called it") are
different failures and the reason string says which — a pass/fail bit would
throw that away. **Arg shape, not arg values**: the eval must not become a
brittle string comparison against invented slugs.

`tool-call-f1` is layered on the cases with exactly one defensible answer.
Verified against the installed promptfoo rather than assumed: it takes a list of
tool names, defaults `threshold` to 1, scores unordered F1, and its extractor
understands the Anthropic provider's stringified `tool_use` blocks.
`is-valid-function-call` is **not** usable here — it delegates to the provider's
`validateFunctionToolCall`, which the Anthropic provider does not implement, so
it fails regardless of output. The code grader covers what it would have.

### 4. Negatives are first-class

Twelve of the twenty-five seed cases are negative, because a suite of positives
measures only eagerness — and eagerness is exactly what sharpening a tool
description most easily creates. They cover the two shapes: answer-without-a-tool
(the instructions already contain the answer; calling `reports_upload` to find
out whether the URL changes *publishes a report to answer a question*), and
must-not-fire (`reports_delete` when the user said "check with me first";
`folders_share` when the folder is already shared and the reports are the
problem).

### 5. Over-claim: from lexical to behavioural

Five cases probe whether the model claims reach it does not have, under
escalating pressure — an admin entitlement framing, a same-team framing, a plain
question, a leading yes/no compliance question, and a free-form security-review
paragraph. Their deterministic assertions are **derived from
`OVERCLAIM_PATTERNS`**, not restated: `surface.ts` expands each pattern into the
literal phrases it matches and the smoke tier requires every guard case to
forbid all of them. Adding a fourth pattern to `instructions.ts` therefore fails
the fast gate until the golden set grows with it. (promptfoo's `regex` assertion
compiles with no flags and so cannot carry the patterns' `/i`;
`not-icontains-any` over the expanded phrases is exactly equivalent and is
case-insensitive.)

`llm-rubric` is used on **one** case, the free-form paragraph, because "is this
description of the boundary accurate?" cannot be decided by string matching — a
wrong answer can avoid every forbidden phrase. It follows every constraint: one
isolated dimension, a structured rubric, `threshold: 0.8`, an explicit "return
Unknown" instruction, and `claude-haiku-4-5` judging `claude-sonnet-5` — a
**different model from the generator**. The smoke tier enforces the different-model
rule, the explicit threshold, and a hard cap of two judged cases.

### 6. pass^k

`--repeat 3`, with the job failing if **any** trial fails — pass^3. A single
green run on a non-deterministic system is not evidence. Three rather than ten
because cost scales linearly with k on a per-PR gate; raise it if flaky cases
start slipping through. promptfoo namespaces the response cache per repeat
index, so the k trials are genuinely independent samples rather than one call
replayed three times.

### 7. Twenty-five seeds, and the rest grown from real failures

The issue's target is 20–50 cases **drawn from real observed failures**
(Anthropic's primary guidance, not the 100–200 of secondary blogs). The suite
seeds 25 — 13 positive, 12 negative — and the headroom is deliberately unspent:
a case invented at a desk measures our imagination; a case harvested from a
failure measures the product. `tests/evals/README.md` carries the six-step
procedure for turning an observed failure into a case, and records the
saturation rule: **a suite at 100% is a regression gate, not a research tool**,
so a long green streak is a signal to harvest harder cases, not a signal that
the surface is finished.

### 8. Cost control

Response caching on (14-day TTL), the CI cache persisted across runs; path-scoped
triggering so the job only runs on PRs touching a prompt surface; a cheap
generator and a cheaper judge. A change to the instructions, a tool description,
the model or the provider config busts the cache key and re-bills — which is
correct, because that is exactly when the eval needs to actually run.

### Pending: the provider and the key (operator decision, still open)

`anthropic:claude-sonnet-5` is the **configured default**, with
`claude-haiku-4-5` as the judge. The reasoning: cheap enough for a per-PR gate,
capable enough that a failure indicts the prompt rather than the model, and the
same vendor as the surface's primary consumer. This ADR records it as the
default **pending the operator's final call** on provider and budget.

CI needs `ANTHROPIC_API_KEY` in repo secrets, and repo secrets here are
**Terraform-managed** (the Phase 0b pattern, like `GEMINI_API_KEY`) — so
provisioning it is an `infra/terraform` change plus a real key plus a budget.
That decision is explicitly not made in this PR, and no Terraform is touched.

Until it is made, `.github/workflows/prompt-evals.yml` **skips green**: it checks
out, installs, runs the keyless `promptfoo validate config`, emits a GitHub
notice naming this ADR and issue #264 as the reason, and exits 0. It is a new
workflow and is not in `required_status_checks`, so it gates nothing in either
state. The day the secret lands, the same workflow starts evaluating with no
further change.

### New dependencies

Three root devDependencies, all test-tier only, none reaching production or the
dependency-locked domain/application layers:

- **`promptfoo`** — the harness this ADR adopts. Note it requires Node ≥ 22.22;
  CI runs Node 24, and the rest of the repo is unaffected (`engines` stays ≥ 20).
- **`yaml`** — so the smoke tier *parses* the config instead of string-matching
  it. The repo already regrets the token-matching shortcut in the
  `openapi-structure` validator; a config that no longer parses is the single
  most likely way this suite silently stops running.
- **`zod`** — already `apps/mcp`'s own dependency; declared at the root so
  `tests/evals/surface.ts` can turn the registered tool shapes into JSON Schema.
  pnpm resolves both to the same store path, so it is one module instance.

## Consequences

- **Good**: `apps/mcp/CLAUDE.md` §5's promise is kept — the prompt surface now
  has a target function, and a prompt-surface PR gets an automated behavioural
  signal instead of only reviewer attention.
- **Good**: the fixture drift guard makes an `instructions.ts` / `tools.ts` edit
  *visible* as a fixture diff, which is independently useful for the ADR-030
  Axis-2 confirm-list (prompt-surface deltas are human-only sign-off).
- **Good**: the whole harness is exercisable with no key — `pnpm test`,
  `pnpm evals:validate`, and an `echo`-provider dry run all work — so a
  contributor can develop against it and a reviewer can see it is wired.
- **Trade-off**: the tier is **non-deterministic and costs money**, unlike every
  other gate here. pass^k and caching bound it; they do not eliminate it. It is
  intentionally not a required check.
- **Trade-off**: 25 seeded cases is coverage of the *discriminations we already
  know are hard*, not of the surface. That is the intended starting point, and
  the README's growth procedure is the mechanism — but until failures are
  actually harvested, a green suite means "no known regression", not "correct".
- **Trade-off**: the golden set is authored against `claude-sonnet-5`. Some
  cases may be model-sensitive; changing the provider is a re-baselining event,
  not a config edit.
- **Trade-off**: the fixture drift guard compares the *generated* JSON Schema,
  which comes from zod's `toJSONSchema` rather than from the MCP SDK's own
  serializer. The descriptions — the actual prompt surface — are verbatim; the
  schema types are a faithful but not byte-identical rendering of what a real
  client receives.
- **Neutral**: no production code, no product behaviour and no `.feature` file
  changes — the tier only reads `apps/mcp/src`. No Terraform is touched.

## More information

- Issue #264 — the PRD, its four success criteria, and the sourced research.
- `tests/evals/README.md` — how to run it, how to add a case from a real
  failure, the verified assertion types, cost notes.
- `tests/evals/surface.ts` — the single seam both tiers read the shipped
  surfaces through.
- `docs/adr/0072-mcp-agent-onboarding.md` — the three onboarding layers this
  tier measures.
- `docs/adr/0069-agent-tool-trust-boundary.md` — the boundary the over-claim
  cases enforce behaviourally.
- `docs/adr/0081-mutation-and-property-testing.md` — the sibling Phase-5 answer
  to "what measures whether the target function is load-bearing".
- `apps/mcp/CLAUDE.md` — the nested rules for this tree, updated to point at
  the live tier.
- [Anthropic — Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
  · [Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
  · [promptfoo CI/CD](https://www.promptfoo.dev/docs/integrations/ci-cd/)
  · [evalite](https://www.evalite.dev/)
