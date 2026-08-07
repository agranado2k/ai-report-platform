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
5. **Evals are the target function here**, as tests are for code. They do not exist yet
   (issue #264) — until they land, this surface carries more human review, not less.
