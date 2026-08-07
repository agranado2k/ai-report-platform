# apps/mcp — the prompt surface IS the product surface

Everything a host agent reads is shipped behavior, not documentation. Treat these three
ADR-0072 layers as source code under test:

- **Layer 0** — the server `instructions` string (`src/instructions.ts`) and the tool
  descriptions in `src/tools.ts`.
- **Layer 1** — the canonical packaged skill, `skill/centaur-spec/SKILL.md`.
- **Layer 2** — the per-host distribution copies under `packaging/`.

1. **Never over-claim reach.** No onboarding artifact may state or imply the server sees
   another user's or org's data — it is a thin client (ADR-003/0051) and `/api/v1` is the
   sole authorizer (ADR-0059/0060/0069). `OVERCLAIM_PATTERNS` in `src/instructions.ts` is
   the guard, asserted by `server.test.ts` and `prompts.test.ts`. Keep it green; add new
   prompt text to those assertions rather than routing around them.
2. **Keep the packaged skill byte-identical.** `skill-sync.test.ts` pins the Layer-2 copy
   to the Layer-1 canonical file. If it fails, re-copy canonical → packaged; never edit
   the packaged copy independently.
3. **No tool-poisoning language** — no "always prefer this tool"; teach workflow verbs,
   stay short.
4. **Any prompt-surface delta is Axis-2 confirm-list material** — a human decides whether
   the new wording says the right thing; a reviewer agent may not sign it off.
5. **Evals are the target function here**, as tests are for code — and they are live
   (ADR-0083, issue #264). The suite is `tests/evals/`; read its `README.md` before
   editing any of the three layers.
   - The golden set is **generated from** `src/instructions.ts` and `src/tools.ts`, not
     copied out of them. Change either and you must run `pnpm evals:sync` — the keyless
     smoke tier in the ordinary `pnpm test` gate pins the fixtures and fails otherwise.
     The regenerated fixture diff is what makes the prompt-surface delta reviewable.
   - Adding an `OVERCLAIM_PATTERNS` entry also fails the fast gate until the over-claim
     cases in `tests/evals/golden-set/overclaim-guard.yaml` grow with it; the forbidden
     phrases are derived from those patterns, never restated.
   - `pnpm evals:validate` checks the suite with no API key. `pnpm evals` runs it for
     real and needs `ANTHROPIC_API_KEY`; CI runs it path-scoped in
     `.github/workflows/prompt-evals.yml`, which **skips green** until the operator
     provisions that secret (Terraform-managed — decision still open).
   - The behavioural signal is advisory, not a merge gate. Rule 4 still stands: a
     prompt-surface delta is Axis-2 confirm-list material, and a green eval run does not
     sign it off.
   - A regression you find by hand becomes a case. `tests/evals/README.md` carries the
     procedure; the suite is seeded at 25 and grows from **real** failures only.
