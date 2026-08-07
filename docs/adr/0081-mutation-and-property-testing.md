# ADR-0081: Mutation testing and property-based testing for the pure layers

- **Status**: Accepted
- **Date**: 2026-08-07
- **Deciders**: agranado2k
- **Supersedes / amends**: extends ADR-0042 (Vitest as the node test tier) with two tools that run **on top of** it, not beside it; leans on ADR-024 (functional, side-effect-free `packages/domain` / `packages/application`) for why the calibration target is cheap; complements ADR-0079's tier boundaries (mutation testing measures the tier, it is not a new tier); feeds the Axis-2 behavior confirm-list of the `/review-and-evaluate` flow (ADR-030 / PR #263).
- **Superseded by**: —

## Context and problem statement

This repo's whole SDLC uses **tests as the agent's target function**: `/tdd` writes a failing test, the agent makes it pass, the `.husky/pre-push` pairing guard refuses source changes that carry no test changes, and CI's green tick is what authorises a merge. Every one of those controls measures the same thing — *do the tests pass?* None of them measures whether the tests are **load-bearing**.

That gap has a specific, observed failure mode with LLM agents: **assertion weakening**. An agent that cannot make a test pass can instead make the test ask for less — relax an `toEqual` to a `toBeTruthy`, drop a branch from an `it.each`, delete the case that was failing. The suite stays green, the pairing guard stays satisfied, coverage barely moves (the line still executes), and the review agents can only offer an opinion that "this test looks weak". There is no machine signal that says *this assertion enforces nothing*.

A surviving mutant is exactly that signal, stated objectively: Stryker deletes or inverts a piece of production behaviour, re-runs the tests, and if they still pass, no test was checking that behaviour. It converts "this test looks weak" from a reviewer's taste into a reproducible finding with a file, a line and a diff.

The second half of the same gap is at the other end: even honest, hand-written example tests only assert what the author thought to type. `packages/domain` is full of codecs, normalizers and smart constructors whose contracts are **universally quantified** — "*every* uuid round-trips", "*every* normalized address is a fixed point", "*no* input produces an `Acl` that serves more widely than asked for". The three-way normalization drift bug behind `EmailAddress` (claude-review #114) was precisely this: three implementations that agreed on the examples in the tests and disagreed everywhere else. Example tests cannot express a universal claim; property-based tests can.

Both tools were scoped in the AI-SDLC plan (issue #265, phase 5.1/5.2). The question this ADR answers is not *whether* they are useful but **how they attach to the process without becoming a tax on every push**.

## Decision drivers

- **Give the review layer a machine signal for test quality.** Surviving mutants are the objective form of "this test enforces nothing", and the one control that catches agent assertion-weakening.
- **Cost has to match value.** Mutation testing runs the suite once per mutant. It is inherently orders of magnitude more expensive than a test run, and putting it on every push would trade a large, permanent slowdown for a signal that changes slowly.
- **Nothing new may gate a merge without evidence.** `main` already has no required status checks; adding a flaky or slow one by the back door is worse than adding nothing.
- **Stay inside ADR-024's dependency lock.** Both tools must be **devDependencies only**, invisible to shipped code, and must not push a runtime dependency into the domain layer.
- **Reuse the existing runner.** ADR-0042 chose Vitest; a mutation runner that drives a *different* test runner would mean two definitions of "the tests".
- **Express contracts that are actually universal**, without turning every example test into a generator (property tests are slower and harder to read; they earn their place only where the contract really is "for all").

## Considered options

### For measuring test strength

1. **Stryker (`@stryker-mutator/core` + `@stryker-mutator/vitest-runner`), on demand / differentially** *(chosen)*.
2. **Stryker on every push / as a required check** — rejected. Even the calibrated best case (below) is ~50s for one small package; the same policy applied across the workspace, per push, buys a signal that moves slowly at a cost paid constantly. Worse, it would make the mutation score a target rather than a diagnostic, and a score that must not regress is a score people game with trivially-killed mutants.
3. **Coverage thresholds instead** — rejected as a substitute. Coverage says a line ran; it says nothing about whether anything asserted on what it did. The `parseAccessClaims` finding below sat at full line coverage while every guard in it was unasserted. Coverage remains useful, but it does not answer this question.
4. **A "test hygiene" review agent alone** (the ADR-030 status quo) — rejected as sufficient. It produces opinions that are cheap to argue with. Kept, but re-pointed: it should now cite surviving mutants.
5. **Hand-rolled "chaos" edits during review** — rejected: unreproducible, unbounded, and exactly the manual step ADR-0079 already established is not a control.

### For expressing universal contracts

1. **`fast-check` property tests in the existing Vitest tier** *(chosen)*.
2. **Hand-written table tests with a wider table** — rejected as a substitute: it postpones the same problem. A table is still a list someone typed; it cannot shrink a counterexample, and it does not explore the space between the rows.
3. **A separate property-test tier / runner** — rejected: `fast-check` is a plain library, its properties are ordinary `it()` bodies, and giving them their own runner would fragment the definition of "the unit suite" for no benefit.
4. **Schema-driven fuzzing at the HTTP boundary** — rejected *for now*, not on principle: the boundary is where ADR-0019 says real infrastructure belongs, and a fuzz tier there is a much larger commitment. The pure layers are the cheap win (ADR-024), so they go first.

## Decision outcome

Chosen: **Stryker on demand, calibrated on `packages/domain`, plus `fast-check` property tests in the same Vitest tier.**

### 1. Mutation testing is a diagnostic, not a gate

`pnpm test:mutation` (root) → `pnpm --filter arp-domain test:mutation` → `stryker run` against `packages/domain/stryker.config.json`. It runs:

- **on demand**, when someone wants to know whether an area's tests are load-bearing;
- **differentially**, scoped to the files a PR touched (`stryker run --mutate 'src/acl.ts'`), which is what makes it affordable inside a review;
- **never** on every push, and **not** as a required status check. `thresholds.break` is `null` on purpose: the run reports, it does not fail.

The mutation score is an input to the **Axis-2 behavior confirm-list**, not a number to defend. A surviving mutant is a question for a human ("is this behaviour meant to be enforced?"), and the two legitimate answers are *strengthen the test* and *the mutant is equivalent*.

### 2. `packages/domain` is the calibration target, and it stays the reference

ADR-024 makes the domain layer pure — no I/O, no environment, no database — so a mutant costs a function call, not a container. That is what makes the numbers below good rather than merely tolerable, and it is why the tool is introduced here rather than against an adapter or a Remix route. Extending it to `packages/application` is a follow-up with its own cost calibration; extending it to the apps is **not** planned.

### 3. Property tests state the laws; example tests keep stating the cases

`fast-check` is a devDependency of `arp-domain`. Property tests live next to the code as `*.property.test.ts` — the `*.test.ts` suffix is load-bearing (it is what the ADR-0042 Vitest globs collect), and the `.property` infix is documentation for the reader. They use fast-check's defaults: 100 runs per property, **random seed per run**, no pinned seed. A property that fails intermittently is reporting a real edge case the code does not handle, and pinning a seed would hide exactly the finding the tool exists to produce; fast-check prints the seed and shrink path on failure, so any counterexample is replayable.

Property tests **do not replace** the neighbouring example tests. Examples document the concrete cases a reader needs ("`A@B.com ` normalizes to `a@b.com`"); properties document the law that covers the cases nobody wrote down.

### 4. Refactor-only passes never mix with behaviour changes in one commit

A refactor commit that also changes behaviour defeats every control above: the mutation delta cannot be attributed, the behaviour diff cannot be read, and the review agent's confirm-list has no clean surface to compare. So a commit is **either** a pure refactor (behaviour-preserving; tests unchanged except for mechanical renames) **or** a behaviour change (test diff and source diff tell the same story) — never both. This is a commit-hygiene rule, enforced by review rather than by a hook, and it is recorded here so the rule has a citable home.

### 5. Calibration results (2026-08-07, this ADR's own run)

Run on `packages/domain` — the **full** package, not a subset; no narrowing was needed. `concurrency: 4`, `coverageAnalysis: "perTest"`, Vitest 3.2.x, Node 22, Apple Silicon.

| Metric | Baseline (tests as they stood) | After this ADR's test work |
| --- | --- | --- |
| Source files mutated | 28 (of 58 in the package) | 28 |
| Mutants generated | 1054 | 1054 |
| **Mutation score (total)** | **85.01 %** | **86.34 %** |
| Mutation score (covered code) | 87.41 % | 88.69 % |
| Killed | 890 | 904 |
| Survived | 129 | 116 |
| Timeout | 6 | 6 |
| No coverage | 29 | 28 |
| Errors | 0 | 0 |
| **Wall-clock** | **~51 s** | **~52 s** |
| Tests run per mutant (avg) | 8.87 | 9.16 |

The "after" column includes both the strengthened `access-token.test.ts` (§6) and the 19 new property tests, which killed mutants of their own — `external-id.ts` 89.29 % → 91.07 %, `acl.ts` 82.19 % → 83.56 % (and its one no-coverage mutant became covered). Note the *test suite* grew from 343 to 372 tests while the wall-clock barely moved: with `perTest` coverage analysis the cost is driven by mutants, not by test count.

**Honest caveats on these numbers.**

- ~51 s is the *warm, local, 4-way-parallel* time on a developer machine. CI on a shared runner will be slower; treat this as a lower bound.
- Stryker reports **181 static mutants (17 % of the total) consuming ~84 % of the run time** — mutants in module-level initialisation, which force a full re-run of the file's tests. `ignoreStatic` would cut the wall-clock sharply at the cost of a blind spot. It is deliberately **left off**: at ~51 s the run is cheap enough that correctness of the measurement beats speed.
- The 29 no-coverage mutants are concentrated in `errors.ts` (16) — constructors for error kinds nothing yet raises. They are honest zeros, not a tooling artefact.
- The score is **not a target**. 85 % here means the domain's tests kill roughly six of every seven behaviour changes; the remaining seventh is the interesting reading material, and some of it is equivalent mutants that can never be killed.

### 6. The finding this calibration actioned

The baseline run's most consequential cluster: **13 surviving mutants in `packages/domain/src/access-token.ts`, 10 of them inside `parseAccessClaims`** — the narrow that `claims-codec.ts` documents as *"the security boundary between token types sharing the same secret + wire format"*. Every type guard in it could be deleted (`if (…) return null` → `if (false) return null`) with the whole suite still green, **except** the `owner` one, which a hand-crafted-payload test did cover.

The module's own doc comment claims it rejects *"a mistyped `mode`/`email`/`owner`"*. One third of that promise was enforced. The `mode` claim is the revocation-C binding from ADR-0056 — it is what stops a stale long-lived cookie surviving an `Acl` mode switch — so a non-string `mode` narrowing successfully means the viewer's mode comparison silently stops discriminating.

Actioned red-green, in that order: the mutant `access-token.ts:34` `if (claims.mode !== undefined && typeof claims.mode !== "string") return null;` → `if (false) return null;` was applied to the source by hand, the strengthened test was written and shown to **fail** against it, the source was restored, and the test passes. `access-token.ts` went from **13 survivors to 2** (80.88 % → 97.06 %).

The two that remain are **equivalent mutants**, deliberately left alive rather than chased with a meaningless assertion — and reasoning about why is the useful part of the exercise:

- `if (false || raw === null)` (dropping `typeof raw !== "object"`). Unkillable: only objects and arrays carry properties in JSON, and `typeof` says `"object"` for both, so any payload that gets past the dropped check with a usable `slug` was already an object. A non-object payload still falls through to the next guard and is rejected there.
- `if (false || typeof claims.exp !== "number")` (dropping the `slug` type check). Unkillable one level up: the codec's own `claims.slug === expectedSlug` compare is strict, and `expectedSlug` is always a string, so a non-string `slug` can never match a real slug. The guard is defence in depth, not the load-bearing check.

**No production source was modified.** The whole fix was in the assertions — which is the point: the behaviour was already correct, and only the *evidence* that it was correct was missing.

## More information

**What landed**

- `packages/domain/stryker.config.json` — mutate `src/**/*.ts` minus tests and the barrel `index.ts`; `concurrency: 4`; HTML report to the gitignored `packages/domain/reports/mutation/`.
- `packages/domain/vitest.config.ts` — a package-scoped Vitest config. The repo-wide suite still runs from the root config; this exists so Stryker's runner can drive **one package's** tests per mutant. Its `include` glob must stay in sync with the root config's `packages/*/src/**/*.test.ts`.
- Scripts: `pnpm test:mutation` (root) and `pnpm --filter arp-domain test:mutation`; `pnpm --filter arp-domain test` for the package's own Vitest run.
- Property tests: `slug.property.test.ts`, `external-id.property.test.ts`, `email-address.property.test.ts`, `acl.property.test.ts` — 19 properties over `Slug`, `External Id`, `EmailAddress` and `Acl`.
- Strengthened `access-token.test.ts` (the §6 finding).

**pnpm gotcha.** Stryker's default plugin discovery (`@stryker-mutator/*` glob) finds nothing under pnpm's isolated `node_modules` and fails with `Cannot find TestRunner plugin "vitest"`. The config names the plugin explicitly instead. Worth knowing before adding a second Stryker plugin (a checker, another runner).

**Dependency posture.** `@stryker-mutator/core`, `@stryker-mutator/vitest-runner` and `fast-check` are devDependencies of `arp-domain`. None is imported by shipped code; ADR-024's dependency lock on the domain layer's *runtime* dependencies is untouched.

**Follow-ups, explicitly not done here.**

- Wiring the differential (`--mutate` on changed files) invocation into `/review-and-evaluate`'s Test Hygiene sub-agent so it cites mutants instead of opinions.
- A periodic (weekly / labelled-PR) scheduled run to track the score over time, once there is a place to put the history.
- Calibrating `packages/application`, which is pure but has more collaborators.
- The remaining 116 survivors are a reading list, not a backlog. `anchor.ts` (66.67 %) and `brand.ts` (62.50 %) are the weakest files; `errors.ts`'s 27.59 % is mostly the no-coverage constructors above. `comment.ts` (14 survivors) and `folder.ts` (21) are the largest absolute clusters and the obvious next read.
