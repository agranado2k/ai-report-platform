# Editor spike decision — ProseMirror

**Date:** 2026-07-06
**Status:** spike verdict — input to ADR-0062 (editing model & "Report HTML" schema)

## Verdict

**ProseMirror**, paired with `prosemirror-changeset` for visual diff. TipTap (MIT core only) stays on
the table as a possible ergonomic wrapper later — it's ProseMirror underneath, so it doesn't reopen the
decision. **No paid TipTap Pro / CKEditor** — the suggestion-mode and comments packages behind those
paywalls are exactly the features we're about to hand-roll anyway; buying them buys vendor lock-in, not
capability we lack a spike-proven path to.

Plate.js was evaluated in parallel and rejected. Both sandboxes were built against the real fixture
(`spike/fixture/ai-readiness-report.html`, 1045 lines, the AI-readiness report used throughout this
repo's own demos) and their test suites were run and verified independently by the orchestrating agent:
**ProseMirror 29/29 pass, Plate 23/23 pass.** Passing suites alone don't decide it — the fidelity/export
numbers below do.

## Evidence

| Dimension | ProseMirror | Plate.js |
| --- | --- | --- |
| Bespoke-class fidelity, L1 (generic attr-retaining schema) | 13/15 fixture classes zero-delta | classes on any plugin-claimed tag (`p`, `ul`, `h2`/`h3`, `main`) are **lost**, incl. `desc` (33 occurrences — the exact hook the paragraph-comment feature would anchor to) |
| `chip` mark (bespoke inline, variant enum), L2 | lossless, ~26 LOC / ~15 min | lossless too, ~45 LOC — but on top of 60–90 min reverse-engineering the undocumented static rendering path |
| Static export size | 73.6 KB (vs 86.8 KB input — editor markup stripped cleanly) | 390 KB (vs 86.8 KB input) — `data-slate-*` instrumentation ships in the "static" export |
| Export cleanliness | zero editor attributes in output | documented className-passthrough break in the static pipeline (reverse-engineered from source, not just observed) |
| Suggestion accept/reject (canned stub, no LLM) | PASS — 106 LOC hand-rolled marks. `prosemirror-changeset` is a diff/reconciliation tool, not a pending-suggestion primitive — building accept/reject state on it was the real (non-trivial) work | PASS — 45 LOC via built-in `@platejs/suggestion` |
| Visual diff (word-level insert/delete) | PASS — `prosemirror-changeset` | PASS — `@platejs/diff` + custom renderer |
| Collab (Yjs) smoke | wires fine; `y-prosemirror` is the more mature binding | wires fine |
| Shell/body split (presentation shell vs editable body) | validated | validated |
| Ecosystem stability | stable API | mid-flight rebrand: `@udecode/plate` deprecated in favor of `platejs` during the spike |

**Decision rationale:** the rubric's two dominant factors are HTML fidelity and export cleanliness —
the artifact this product sells *is* the HTML, not the editing session. Both go decisively to
ProseMirror. Plate's ~61-LOC suggestion-loop advantage (45 vs 106) is real but one-time, and it doesn't
offset losing class fidelity on the exact elements (`p.desc`, headings, lists, `main`) that carry the
bespoke design language of every report in this platform.

## Accepted costs & mitigations

| Cost | Mitigation |
| --- | --- |
| `prosemirror-tables` ships with no `thead`/`tbody` concept | write a custom `tableNodes` schema extension so `<table><thead>…</thead><tbody>…</tbody></table>` round-trips (the fixture has 2 tables, both with real `thead`/`tbody`) |
| ProseMirror auto-wraps bare inline content in `<p>` inside block containers | normalize report-generator output accordingly (no bare inline text as a direct child of a block node) rather than fighting the editor's invariant |
| No built-in suggestion-mode primitive | ~106 LOC of hand-rolled marks + accept/reject state, proven out in the spike; budget this as real (if bounded) implementation work in the editing-model phase, not a footnote |

## "Report HTML" schema v0

Derived directly from the fixture (`spike/fixture/ai-readiness-report.html`). This is a **v0 sketch**,
not a ratified contract — it exists to give ADR-0062 / phase 4 a concrete starting point. Expect node
names and the attr-retention mechanism to be hardened (and possibly renamed) there.

**Shell / body split** (validated by both spikes): a report document is split into a **presentation
shell** (`<head>` + `<style>` — fonts, design tokens, the CSS that makes a Centaur report look like a
Centaur report) and an **editable body** (everything inside `<body>`). The editor's ProseMirror schema
only ever owns the body; the shell is opaque, versioned alongside it, and reattached unmodified on
export. This keeps the editor blind to (and safe from) arbitrary shell CSS/script content.

**Document structure**
- `section` — top-level report section
- `sec` heading — section heading carrying a `secnum` (the numbered section label, e.g. "01")

**Blocks**
- `card`
- `checklist`
- `resgroup` / `resrow` — grouped result rows
- `tablewrap` + `table` — wraps `<table>`; requires custom `tableNodes` for `thead`/`tbody` (see costs above; fixture has 2 tables, both with `thead`+`tbody`)
- `grid` with a column-count variant (`g2`, `g3`, … — fixture has both)
- `details` / `summary` (fixture has 7 pairs)
- `p` variants: `.desc`, `.lede`, `.sub` (paragraph roles distinct from a bare `<p>`)

**Inline marks**
- `chip` — carries a `variant` attribute, enum `[cto, staff, pm, now, 1yr, 5yr, have, sharpen, build]` (all 9 confirmed present in the fixture as `chip-<variant>` classes)
- `pill`
- `kbd`
- `strong`, `em`, `a` — standard marks, retained as-is

**Generic attr-retention rule**
Any class or attribute not claimed by one of the named nodes/marks above is preserved verbatim on a
generic block or inline node (the "L1" schema tested in the spike) rather than silently dropped. This
is the mechanism that got ProseMirror to 13/15 zero-delta on unmodified bespoke classes with no
per-class schema work — new report styling should degrade to "preserved but uninterpreted" by default,
never to "stripped."

## Re-running the sandboxes

```bash
# ProseMirror spike (29 tests)
cd spike/prosemirror && npm install && npx vitest run

# Plate.js spike (23 tests)
cd spike/plate && npm install && npx vitest run
```

Both run against the shared fixture at `spike/fixture/ai-readiness-report.html`. Neither sandbox is
wired into CI or the workspace root — they're throwaway evaluation code, kept only until ADR-0062 lands.
