# Brief format — the exact shapes the brief writes

`/design-brief` records into three places the kit already establishes. The
shapes below are what the gate and the other skills read, so they are written
exactly, not approximately.

## 1. The three anchors — engineering article, Architecture section

Each is a bold label at the start of its own line — not a bullet, not
indented — followed by the decision, or by `none — <reason>`. Anything else on
the line is free prose.

```md
**Paradigm**: functional in the domain — pure functions over immutable
records; classes only at the adapters, where a framework demands them.

**Architectural style**: ports and adapters. The domain never imports an
adapter; the one rule a newcomer breaks is calling the database from a
domain function.

**Context map**: see the Context map section of the glossary — Ledger is
upstream of Reporting behind an anti-corruption layer (`EntryPosted` crosses);
Billing conforms to Ledger.
```

The none-with-reason form, for a system that has no shape yet:

```md
**Context map**: none — one context until the second product line exists;
revisit when Reporting is more than a query.
```

The advisory is silent once **one** anchor carries a decision; which anchors a
project fills is the project's call. Fill all three anyway: a `none` with a
reason is a decision a later reader can act on, and a missing line is not.

## 2. The context map — glossary, Context map section

One `###` block per context, one line per edge, and every edge declared from
both sides: the same relationship word on both lines, only the role differs.
The glossary's Context map header comment carries the one-line gloss of each
relationship in Evans's set.

```md
## Context map

### Ledger

- **Ledger → Reporting**: anti-corruption layer — upstream; publishes
  `EntryPosted`, spelled exactly as the term above.
- **Ledger → Billing**: conformist — upstream; publishes nothing
  Billing-specific.

### Reporting

- **Reporting → Ledger**: anti-corruption layer — downstream; consumes
  `EntryPosted`, translated into `ReportRow` at the edge; nothing of Ledger's
  model leaks past it.

### Billing

- **Billing → Ledger**: conformist — downstream; uses Ledger's `Entry` as-is.
```

Two declarations of one edge that name different relationships are the
finding, not a formatting error. An edge declared by one side only is half a
decision, and a reader can tell because the other block does not mention it.

## 3. The decision record — one MADR file, indexed in the same commit

Copy the project's ADR template; do not retype it. The title states the
decision: *"Adopt ports and adapters with a functional domain"*, never *"Which
architecture?"*. The sections the brief must fill, beyond the template's own:

- **Considered options** — both candidates by name, with the constraint each
  was designed under, and the comparison on complexity: change amplification,
  cognitive load, unknown unknowns. The chosen one is marked; the other's
  rejection reason is in terms of those drivers.
- **Decision outcome**, as numbered clauses:
  1. The paradigm and where the line is.
  2. The architectural style and the one rule a newcomer would break.
  3. The subdomain classification — core, supporting, generic — and where the
     design investment goes.
  4. The patterns adopted, each with the complexity it removes; the patterns
     rejected, each with the reason. Over-application named as the risk.
  5. **The coexistence clause**: test-driven development drives every
     ticket's tactical loop — red, green, refactor, one behaviour at a time —
     and this brief plus the periodic red-flag scan are the strategic
     investment around it. Ousterhout's critique of test-first (that it
     optimises for working features over good design) is answered by keeping
     both: the tests are the target function, the brief decides the target's
     shape.
  6. **Explicit non-goals** — what the brief does not decide (a library, a
     deployment shape, a database) so it is not quietly assumed later.
- **Consequences** — both directions, including the honest limitation: what
  this shape makes expensive.
- **More information** — the path of the comparison report that argued for
  it, and the glossary terms the brief coined.

## 4. The comparison report — outside the repo tree

`<tmpdir>/design-brief-<YYYYMMDDTHHMMSSZ>.md` (or `.html`). Header: repo name,
date, the subdomain classification. Then **the exploration's data** — the
counts and hot spots the comparison will cite, so no number in the report
arrives unsourced — then one section per candidate in the order of the
procedure's five points, then the comparison, then the recommendation.
Diagrams, when the argument needs them, are real drawings in the HTML
rendering — never ASCII art. The report is a conversation artifact; the
decision record is what the repo keeps.
