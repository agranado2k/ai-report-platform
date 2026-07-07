# ADR-0066: AI suggestion mode

- **Status**: Proposed — deferred to a future epic (explicitly NOT scheduled)
- **Date**: 2026-07-07
- **Deciders**: agranado2k
- **Relates to / amends**: builds on ADR-0062 (editing model & Report HTML schema — the pending-suggestion marks and the edit-save pipeline this ADR will use), ADR-0037 (upload pipeline — an accepted suggestion produces a new `ReportVersion`, no new pipeline).

## Context and problem statement

The editor spike (`spike/DECISION.md`, PR #144) proved out a hand-rolled suggestion-mode mechanism on ProseMirror — pending insert/delete marks with accept/reject state, ~106 LOC — as part of choosing ProseMirror over Plate.js. The editing epic (ADR-0062) locks the document schema and save pipeline these marks will sit on top of. This ADR exists to record, ahead of time, the design constraints an AI-suggestion feature must satisfy so that when a future epic picks it up, it is **additive** to ADR-0062 rather than a schema or pipeline renegotiation. It is not a build authorization — no LLM integration work is scheduled by this ADR.

## Decision drivers

- Don't let a future AI feature force a rework of the ADR-0062 schema or save pipeline — lock the constraints now, while the schema is fresh.
- Suggestions are writes (they eventually mutate report content) — they must clear the same auth bar as any other content-changing action, never a shortcut.
- No LLM calls anywhere in the codebase until this ADR is formally accepted for implementation — this stub does not authorize spend or integration work.

## Decision outcome (constraints recorded, not yet built)

1. **Mechanism**: suggestion state is represented as pending insert/delete **marks on the ProseMirror model** (the ADR-0062 schema), reusing the spike-proven ~106 LOC mechanism — not a parallel data structure.
2. **Agent**: the Anthropic SDK (latest Claude model at implementation time) reads an anchored comment plus surrounding node context and proposes an edit as a pending suggestion mark — it never writes directly to the document or storage.
3. **Accept/reject flow**: the user accepts (which produces a new `ReportVersion` through the existing ADR-0062 §5 edit-save pipeline — same scan gate, same versioning, no shortcut) or rejects (the pending mark is discarded, no version produced).
4. **Auth**: because an accepted suggestion is a write, it must satisfy the full `canWrite` invariant (`isOwner OR hasWriteGrant`, ADR-0059/0060) — an AI suggestion is not a lesser-privileged write path.
5. **No LLM calls until acceptance**: nothing in this epic (ADR-0062/0065) wires up an actual model call; this ADR is the gate for that work, and it is explicitly not scheduled.
6. **A known generalization needed at implementation time**: the spike's `findMarkRange` assumed a single pending-suggestion range. Real usage needs multiple, non-adjacent pending suggestions live in one document at once (e.g. several open AI suggestions awaiting review) — the mark-lookup mechanism must be generalized beyond the single-range assumption before this ships.

## Considered options

- **Suggestion representation**: pending marks on the PM model *(chosen, spike-proven)* vs a separate suggestions table/side-channel (deferred consideration — would duplicate position-tracking logic the PM model already gives for free, but not fully evaluated since this is a stub).
- **Scheduling**: defer to a future epic *(chosen)* vs bundle into the current editing epic (rejected — the current epic's scope is the editing model, version history, and their infrastructure; adding LLM integration now would delay a shippable ADR-0062/0065 slice for a feature with no committed timeline).

## Consequences

- **Good**: the ADR-0062 schema is validated as suggestion-mode-compatible before any AI code is written, reducing the risk of a schema break later; the auth invariant is decided early, closing off a "suggestions bypass write grants" shortcut before anyone is tempted to build it.
- **Trade-offs**: this is a stub, not a build plan — model choice details (prompt shape, context window budget, cost), the anchored-comment data model, and the multi-suggestion `findMarkRange` generalization are all still open and will need their own design pass when this ADR moves from Proposed to Accepted.

## More information

- `spike/DECISION.md` (PR #144, deleted per ADR-0062 §8) — the suggestion accept/reject spike evidence (106 LOC, PASS).
- `docs/adr/0062-editing-model-report-html-schema.md` — the schema and edit-save pipeline this feature builds on; ADR-024 binding (vanilla TS `Result`/`pipe`, no I/O in domain code) applies to any suggestion-acceptance logic that graduates into `packages/domain`/`packages/application`.
- `docs/adr/0059-per-user-report-ownership.md` / `0060-per-report-write-grants.md` — the `canWrite` invariant an accepted suggestion must satisfy.
