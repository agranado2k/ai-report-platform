# ADR-0067: Live co-editing

- **Status**: Proposed — deferred (explicitly NOT scheduled)
- **Date**: 2026-07-07
- **Deciders**: agranado2k
- **Relates to / amends**: builds on ADR-0062 (editing model & Report HTML schema — the PM model a CRDT would bind to), ADR-0064 (comment anchoring — the relative-position requirement this ADR depends on), ADR-014 (referenced constraint — no service-worker-based transport at the viewer edge).

## Context and problem statement

The editing epic (ADR-0062) ships a single-editor-at-a-time model. Multiple people editing the same report concurrently — the natural next step for a collaboration product — was smoke-tested in the spike (`spike/DECISION.md`, PR #144: "Collab (Yjs) smoke — wires fine; `y-prosemirror` is the more mature binding") but not designed or built. This ADR exists to record the transport and data-model constraints a future live co-editing feature must satisfy, so it composes onto the ADR-0062 schema rather than requiring a rework, and so comment anchoring (ADR-0064) is built compatibly with it from day one even though co-editing itself is not being scheduled now.

## Decision drivers

- Preserve optionality: don't let the current epic's comment-anchor design (ADR-0064) foreclose live co-editing later.
- Reuse the spike's finding rather than re-evaluate CRDT libraries when this is eventually picked up.
- Respect the existing viewer-origin security constraint (ADR-014) — whatever transport is chosen must not require a service worker on the viewer origin.

## Decision outcome (constraints recorded, not yet built)

1. **CRDT**: if/when pursued, **Yjs** binds to the same ProseMirror model via `y-prosemirror` (the spike-verified binding, smoke-tested against the fixture) — not a bespoke OT implementation.
2. **Transport**: candidates identified but not chosen — self-hosted OSS options (Hocuspocus, y-websocket, PartyKit, Y-Sweet) versus commercial (Liveblocks). Selection is deferred to the epic that actually builds this.
3. **Comment anchors use relative positions from day one** (ADR-0064) — even though live co-editing is not scheduled now, comment anchoring must be built on Yjs-compatible relative-position tracking rather than absolute offsets, so concurrent edits (whenever they land) don't silently orphan existing comments. This is the one piece of ADR-0064 that this ADR constrains today.
4. **ADR-014 constraint carried forward**: no service-worker-based transport is viable — service worker registration is blocked at the edge on the viewer origin (ADR-014). Any real-time transport chosen later must work without one (the dashboard origin, where editing happens, is a different consideration, but the constraint is noted here so it isn't rediscovered late).

## Considered options

- **CRDT**: Yjs *(spike-verified, tentatively favored if/when built)* vs a bespoke OT engine (not seriously evaluated — Yjs's maturity and the existing `y-prosemirror` binding make a custom OT implementation hard to justify) vs no CRDT at all, lock-based single-editor sessions extended with a "someone else is editing" warning (a lower-effort alternative not ruled out, but not evaluated in the spike either).
- **Scheduling**: defer to a future epic *(chosen)* vs build alongside the current editing epic (rejected — real-time transport, presence, and conflict resolution are a materially larger scope than the editing-model + version-history slice this epic ships).

## Consequences

- **Good**: the spike de-risks the core technical question (does Yjs bind cleanly to the ADR-0062 PM schema) before any commitment; requiring relative-position comment anchors now avoids a comment-anchoring rework if/when co-editing lands.
- **Trade-offs**: transport selection, presence UX, and conflict-resolution edge cases remain entirely open; this ADR provides no implementation timeline or budget.

## More information

- `spike/DECISION.md` (PR #144, deleted per ADR-0062 §8) — the Yjs/`y-prosemirror` smoke-test finding.
- `docs/adr/0062-editing-model-report-html-schema.md` — the PM document model a CRDT would bind to.
- `docs/adr/0064-comments-annotations.md` — comment anchor relative-position requirement (constrained by §3 above).
- ADR-014 — no service-worker-based transport at the viewer edge.
