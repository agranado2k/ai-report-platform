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
     real and needs `ANTHROPIC_API_KEY` — a secret that **already exists** (since
     2026-06-02); the open decision in issue #264 is **funding, not provisioning**.
     Because the key is unfunded, every provider call errors, so
     `.github/workflows/prompt-evals.yml` classifies the run: an all-errors result
     (zero assertions executed) emits a notice and exits 0, while genuine assertion
     failures stay red. Both tools need **Node ≥ 22.22** — the repo's `engines` says
     `>=20`, so `nvm use 22.22` (or newer) before running them.
   - Layers 1 and 2 (`skill/`, `packaging/`) are **not measured** by the eval tier —
     no case loads a SKILL.md, and those paths are deliberately out of the
     workflow's `paths:` list. `skill-sync.test.ts` is still their guard. Same for
     `registerPrompts`: the MCP prompt templates never enter a golden-set prompt.
     See `tests/evals/README.md` §"What this tier does NOT measure".
   - The behavioural signal is advisory, not a merge gate. Rule 4 still stands: a
     prompt-surface delta is Axis-2 confirm-list material, and a green eval run does not
     sign it off.
   - A regression you find by hand becomes a case. `tests/evals/README.md` carries the
     procedure; the suite is seeded at 26 and grows from **real** failures only.
