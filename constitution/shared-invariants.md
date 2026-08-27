# Shared invariants — the portable framework

These are the rules that are **not about this project**. They describe how an AI-assisted
software lifecycle stays honest regardless of stack, domain, or vendor. This file is written
to be copied **verbatim** into another repository: it names no product, no package, no
command, and no vendor. Anything that needed one of those went to a `local-*` article
instead.

Read this once per project, not once per task. Where a rule below needs a concrete
mechanism, this repo's binding version lives in `local-workflow.md` (process) and
`local-engineering.md` (stack).

## 1. Specs before code, tickets before sessions

Nothing gets built from a chat message. A change of any size starts as a written
spec/PRD, and a multi-session build is decomposed into tickets **before** the first
session opens. One ticket, one fresh session. If you cannot write the ticket, you do
not understand the work well enough to delegate it to an agent — and neither does the
agent.

Feasibility questions are answered by a throwaway spike outside the production tree,
never by speculative production code that "we might keep".

## 2. Every slice is vertical

The unit of work is a demoable slice, not a layer. Before starting, answer: **"what can
I demo when this is done?"** If the answer is "nothing yet, this is the data layer", the
slice is wrong — cut a thinner end-to-end path instead and expand from there.

Horizontal work (all the types, then all the handlers, then all the tests) produces code
that compiles, reviews clean, and demonstrates nothing. It also produces the worst tests:
written in bulk against imagined behavior rather than observed behavior.

## 3. Tests are the target function

An agent optimizes for whatever signal you give it. The test suite **is** that signal, so
it is the specification, not an afterthought:

- **Code** → test-first. Write the failing test, make it pass, then refactor.
- **Prompts and agent-facing text** → evals. A prompt surface with no eval is untested
  code that happens to be in English.
- **The testing infrastructure is the ceiling.** No agent can produce behavior more
  correct than the harness can detect. Time spent on the harness raises the ceiling for
  every future task; time spent working around a weak harness is spent again next week.

A test that cannot fail is worse than no test: it converts an unknown into a false
"verified".

## 4. Fresh context per phase

Each phase (plan, implement, review, QA) starts from a clean context. In particular,
**a reviewer must never see the implementation history** — not the reasoning, not the
abandoned attempts, not the author's justification. A reviewer who has read the author's
narrative reviews the narrative instead of the diff, and will rationalize exactly the
decisions that most need challenging.

The same applies to the human: judge the artifact, not the transcript.

## 5. Standards findings and behavior findings are never merged

Review produces two categorically different outputs, and merging them destroys both:

- **Standards findings** (style, naming, layering, duplication, mechanical correctness)
  are *verifiable from the diff alone*. They are addressed to agents, and an agent may
  fix them autonomously.
- **Behavior findings** (does this do the right thing? is this trade-off acceptable? did
  the semantics change?) are *not decidable from the diff*. They are addressed to humans
  as an explicit confirm-list.

Never let a behavior question ride into an autonomous fix loop dressed as a standards
nit, and never bury a mechanical nit in a list a human has to read.

## 6. Judgment is human-in-the-loop, by label

Every ticket carries an explicit autonomy label, decided when the ticket is written and
not renegotiated mid-session. Work requiring taste, risk assessment, product judgment, or
irreversible consequence is **HITL**; mechanical work with a checkable definition of done
is **AFK**. Ambiguity resolves to HITL.

## 7. Autonomy never includes merge

Whatever an agent is trusted to do, it is not trusted to land it. The merge action is a
human decision with a human's name on it. An agent may prepare, test, review, fix, and
report a change to the point of being one click away — and stops there.

## 8. Process docs are executable or CI-verified

A rule written in a document that nothing checks decays into a lie, and stale standing
instructions are worse than absent ones: they actively poison the context of every agent
that loads them. So each process rule must be either

- **executable** — a hook, script, or command an agent runs, or
- **CI-verified** — a check that fails the build when the doc and reality diverge.

A rule that is neither is a suggestion. Label it as one or delete it.

## 9. Measure the ceiling, don't assume it

Green is a claim, not a measurement. Periodically measure whether the suite can actually
detect breakage — mutation testing on the pure, cheap layers is the standard instrument;
surviving mutants are the objective form of "this test enforces nothing", and they catch
assertion-weakening that no diff review will.

Final acceptance QA goes **through the real user interface**, not through the test
harness that was itself the agent's target. The harness proves the agent hit the target;
only the UI proves the target was in the right place.

## 10. Refactoring and behavior never share a commit

A refactor-only pass changes structure and nothing else; a behavior change changes what
the system does. **They never appear in the same commit.** Mixing them makes the behavior
diff unreviewable — the one diff a human must actually read gets buried under renames —
and it makes a revert impossible to scope.

If a refactor turns out to be needed to make a behavior change tractable, land the
refactor first, on its own, with the suite green before and after.

Per §8 this rule is checkable rather than merely asserted, because the claim is machine-
visible: a commit whose declared type says "structure only" while its own diff touches a
contract artifact has contradicted itself. Review tooling should surface those commits as
a confirm item — the author either splits the commit or relabels it, and both outcomes are
better than a reviewer discovering the mix by reading.

## 11. The context budget is a real budget

Standing instructions are re-read on every request, so their cost is paid every time and
their value must justify that. Keep the always-loaded root small and high-precedence;
push elaboration into articles read on demand; scope package-specific rules to the
package. Duplicated guidance is not redundancy, it is drift waiting to happen — every
rule has exactly one home, and everywhere else points at it.
