# ADR format

This project follows the **MADR template** (https://adr.github.io/madr/) for Architecture Decision Records.

**Registry**: `docs/adr/INDEX.md` — list of accepted ADRs.
**Template / examples**: `docs/adr/0035-bot-merge-workflow.md` and `docs/adr/0036-domain-driven-design.md` show the structure we use.

## When to write an ADR vs a diary entry

- **ADR file in `docs/adr/`** — an architectural decision that constrains future code (which patterns to use, which boundaries to draw, which tools to standardize on). MADR format. Lives in its own file. Status field is the contract.
- **Dated entry in `docs/diary.md`** — chronological development log; what happened on a day, debugging stories, daily progress. Diary entries can reference an ADR by number but are not the source of truth for any decision.
- **CLAUDE.md** — operating instructions for any agent / contributor working in the repo. Style rules, project boundaries, quick-reference table. Does not contain decisions — those go in ADRs.

If a grilling session lands on a decision that constrains future code or interfaces, write it as a proper ADR file under `docs/adr/NNNN-short-kebab-title.md` (next number in sequence; check `INDEX.md`). Otherwise the conversation outcome belongs in the diary or directly in the code under development.

## MADR sections we use

Open any existing ADR (e.g., `docs/adr/0036-domain-driven-design.md`) to see the structure. The required sections:

1. **Title** (`# ADR-NNNN: short kebab description`)
2. **Status, Date, Deciders, Supersedes/Superseded by** (front-matter list)
3. **Context and problem statement**
4. **Decision drivers**
5. **Considered options** (at least 2; "no change" is a valid option)
6. **Decision outcome** (which option chosen, with rationale + consequences split into Positive / Negative / Neutral)
7. **Pros and cons of the options** (per-option, brief)
8. **More information** (sources, related ADRs, glossary cross-references)

Do NOT invent a different ADR format here. The project's MADR convention is the contract; tools should produce ADRs in that shape.

---

*This file replaces the upstream `mattpocock/skills/engineering/grill-with-docs/ADR-FORMAT.md`. Matt's upstream proposes its own ADR template; we use MADR per our own ADR-0036 cleanup work. See `docs/adr/INDEX.md` for the registry and our two existing ADRs for the actual structure.*
