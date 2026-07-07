# ADR-0062: Editing model & "Report HTML" schema

- **Status**: Accepted
- **Date**: 2026-07-07
- **Deciders**: agranado2k
- **Relates to / amends**: ratifies `spike/DECISION.md` (PR #144, editor spike); builds on ADR-0037 (upload & versioning pipeline — edit-save reuses it verbatim), ADR-0038 (viewer serving, unaffected), ADR-012 (content scan — re-applies on every edit-save), ADR-0036 (DDD — domain events, ADR-024 functional/immutable discipline), `docs/events.md` (`ReportVersionUploaded`). Precedes ADR-0065 (version history & visual diff), ADR-0066 (AI suggestions, deferred), ADR-0067 (live co-editing, deferred) — all three build on the schema and pipeline decided here.

## Context and problem statement

The platform hosts static HTML reports with immutable versioning (ADR-0037) but has no in-browser editing story: today the only way to change a report is to re-upload a whole new bundle. The editing epic needs an authenticated, in-dashboard WYSIWYG editor that can open a report, let the owner (or a write-grantee, ADR-0060) make structural edits, and save — while (a) never corrupting the bespoke design language every report bundle carries (custom classes like `chip-cto`, `card`, `resrow` — see the fixture at `spike/fixture/ai-readiness-report.html`), (b) staying inside the existing versioning/scan/promotion pipeline rather than growing a second one, and (c) leaving room for the two follow-on capabilities already on the roadmap — AI-drafted suggestions and live multi-user co-editing — without a schema rewrite.

A two-sandbox spike (PR #144) evaluated ProseMirror and Plate.js against the real fixture to answer the open questions: which rich-text engine, what document schema, and how edits round-trip to storage. `spike/DECISION.md` records the verdict; this ADR ratifies it as binding architecture and folds in the storage/versioning/eventing decisions the spike didn't cover.

## Decision drivers

- **HTML fidelity above all** — the artifact this product sells *is* the rendered HTML, not the editing session; any class or attribute silently dropped by the editor is a product regression.
- **Export cleanliness** — saved HTML must not carry editor instrumentation (`data-*` attributes, editor-only markup) into the versioned artifact.
- **No new versioning system** — edits must flow through the ADR-0037 pipeline (R2-first/commit-last, scan, monotonic promote) so every safety property already proven for uploads holds for edits too.
- **No trust escalation** — content produced by the in-browser editor is exactly as untrusted as an uploaded bundle; it must cross the same scan gate.
- **Room for the roadmap** — the schema and save path must not need to change shape when suggestion-mode (ADR-0066) and co-editing (ADR-0067) land.
- **ADR-024 discipline** — any suggestion/diff logic that graduates into `packages/domain`/`packages/application` stays vanilla TS + `Result`/`pipe`, no new FP libraries, no I/O.

## Decision outcome

### 1. Editor: ProseMirror

**ProseMirror** (MIT-licensed core packages) is the editing engine, paired with `prosemirror-changeset` for visual diff (ADR-0065). TipTap's MIT core is allowed later as an ergonomic wrapper over the same ProseMirror engine — it does not reopen this decision, since the document model and export path are unchanged.

Rejected:
- **Plate.js** — lost bespoke classes on any plugin-claimed tag (`p`, `ul`, `h2`/`h3`, `main`), including `p.desc` (33 occurrences in the fixture — the exact hook a paragraph-comment feature would anchor to); its "static" export shipped `data-slate-*` instrumentation at 390 KB vs 86.8 KB input (4.5× bloat); the className-passthrough break in its static pipeline was only discoverable by reverse-engineering undocumented source.
- **TipTap Cloud** — free tier removed June 2025; tracked-changes and comments are paid add-ons ($49–999/mo) for exactly the capability this epic needs to own.
- **CKEditor 5** — GPL-2+/commercial dual license; track-changes is a premium feature.
- **Lexical and BlockNote** — track-changes support is immature relative to the spike's needs.

Evidence (both suites independently verified by the orchestrating agent — ProseMirror 29/29, Plate 23/23 — passing tests alone did not decide it, the fidelity numbers did):

| Dimension | ProseMirror | Plate.js |
| --- | --- | --- |
| Bespoke-class fidelity (L1 generic attr-retaining schema) | 13/15 fixture classes zero-delta | classes on plugin-claimed tags lost, incl. `p.desc` |
| `chip` mark (bespoke inline, 9-way variant enum) | lossless, ~26 LOC / ~15 min | lossless, ~45 LOC, after 60–90 min reverse-engineering |
| Static export size | 73.6 KB (vs 86.8 KB input) | 390 KB (vs 86.8 KB input) |
| Export cleanliness | zero editor attributes in output | `data-slate-*` ships in "static" export |
| Suggestion accept/reject (canned, no LLM) | PASS — 106 LOC hand-rolled marks | PASS — 45 LOC via built-in `@platejs/suggestion` |
| Ecosystem stability | stable API | `@udecode/plate` deprecated mid-flight in favor of `platejs` |

Plate's suggestion-loop advantage (45 vs 106 LOC) is real but one-time and does not offset losing class fidelity on the elements that carry every report's design language.

### 2. Shell/body split

A report document splits into a **presentation shell** (`<head>` + `<style>` — fonts, design tokens, the CSS that makes a Centaur report look like one) and an **editable body** (everything inside `<body>`). The shell is opaque to the editor: versioned alongside the body, never parsed into the ProseMirror schema, and re-injected unmodified on export. The ProseMirror schema only ever owns the body. This keeps the editor blind to (and safe from) arbitrary shell CSS/script content, and bounds the schema-design problem to structural/content markup only.

### 3. "Report HTML" schema v1

Ratifies `spike/DECISION.md`'s v0 vocabulary as the binding schema, hardened from sketch to contract:

**Document structure**
- `section` — top-level report section
- `sec` — section heading, carrying a `secnum` attribute (the numbered section label, e.g. "01")

**Blocks**
- `card`
- `checklist`
- `resgroup` / `resrow` — grouped result rows
- `tablewrap` + `table` — wraps `<table>`, backed by a custom `tableNodes` schema extension (see accepted costs, §7) so `<thead>`/`<tbody>` round-trip
- `grid` with a column-count variant (`g2`, `g3`, …)
- `details` / `summary`
- `p` variants: `.desc`, `.lede`, `.sub` (paragraph roles distinct from a bare `<p>`)

**Inline marks**
- `chip` — carries a `variant` attribute, enum `[cto, staff, pm, now, 1yr, 5yr, have, sharpen, build]`
- `pill`
- `kbd`
- `strong`, `em`, `a` — standard marks, retained as-is

**Generic attr-retention rule**: any class or attribute not claimed by a named node/mark above is preserved verbatim on a generic block or inline node, rather than dropped. This is the mechanism that gets ProseMirror to 13/15 zero-delta fidelity on unmodified bespoke classes with no per-class schema work, and is the standing rule for all *future* report styling too — new classes degrade to "preserved but uninterpreted," never to "stripped."

### 4. Source of truth: HTML remains THE artifact; ProseMirror doc JSON is a lossless sidecar

The exported HTML stays the canonical artifact served by the viewer (ADR-0038 unaffected) and stored exactly as today. Alongside it, the ProseMirror document — the lossless, structured edit source — is persisted as a sidecar object in R2 at `reports/<reportId>/<versionId>/_source.json`. This is what a subsequent edit session loads (parsing HTML back into a PM doc on every open would be lossy and slow); it is also what ADR-0065's visual diff operates on.

Externally-uploaded reports (no `_source.json`, e.g. a report that has only ever been uploaded, never opened in the editor) have no sidecar. First edit does a best-effort HTML→PM parse using the same L1 generic-retention rule, producing the first sidecar for that version. No `report_versions` schema change — the sidecar is a same-prefix R2 object, not a new column.

### 5. Edit-save is an upload

Saving an edit serializes the PM model back to HTML and produces a **new** `ReportVersion` through the existing ADR-0037 pipeline unchanged: blobs (HTML + shell + the new `_source.json` sidecar) write to R2 first under a new `versionId`, then the DB row + outbox commit atomically, `version_no` assigns as `max+1`, and `PromoteVersionUseCase` promotes only on a clean scan. There is no mutate-in-place path and no parallel "draft" storage tier. The re-scan on every edit-save is a **deliberate trust boundary**: edited or agent-generated HTML is exactly as untrusted as a fresh upload — an editor session is not a bypass of ADR-012's scan gate.

### 6. Event shape: `origin` attribute on `ReportVersionUploaded`

`ReportVersionUploaded` (`docs/events.md`) gains a new `origin: 'upload' | 'editor'` attribute; no new event type. Considered and rejected: a separate `ReportEdited` event — it would duplicate every consumer (`ScanJob` enqueue, `AuditLogger`) for no behavioral difference, since promotion logic doesn't care how the content arrived. `origin` is carried for audit/analytics purposes only.

### 7. Accepted costs (carried from the spike)

- `prosemirror-tables` ships with no `thead`/`tbody` concept — a custom `tableNodes` schema extension is required so `<table><thead>…</thead><tbody>…</tbody></table>` round-trips.
- ProseMirror auto-wraps bare inline content in `<p>` inside block containers. Report-generator output must be normalized so no bare inline text is ever a direct child of a block node — this is worked *with*, not fought.
- No built-in suggestion-mode primitive exists in ProseMirror; the ~106 LOC of hand-rolled pending-insert/delete marks + accept/reject state proven in the spike is real (if bounded) implementation work, budgeted to ADR-0066, not a footnote here.

### 8. Acceptance criterion: `spike/` is deleted in this PR

`spike/` (including `spike/DECISION.md`, `spike/prosemirror/`, `spike/plate/`, `spike/fixture/`) is deleted in the same PR that lands this ADR. History preserves it at commit `393ec98` (PR #144) for anyone who needs to re-run or re-read the sandboxes. Any new glossary terms this epic introduces (e.g. **Report HTML schema**, **Editable body**, **Presentation shell**) land in the same PR per the CLAUDE.md glossary rule — this ADR does not itself edit the glossary.

### Note on ADR-024 binding

When suggestion/diff logic (ADR-0066, ADR-0065) graduates from spike code into `packages/domain` or `packages/application`, it must be vanilla TS using the existing 12-line `pipe()` and 15-line `Result<T, E>` — no new FP library, no I/O in domain code. The PM editor itself (and any suggestion-mark plugin) is UI/adapter-layer code, outside this constraint; only the *decision logic* (e.g. "is this suggestion acceptable," diff computation used for storage-adjacent decisions) is domain/application-layer.

## Considered options

- **Editor engine**: ProseMirror *(chosen)* vs Plate.js (rejected — fidelity/export costs above) vs TipTap Cloud / CKEditor 5 (rejected — paid tracked-changes/comments, the exact feature being hand-rolled) vs Lexical/BlockNote (rejected — immature track-changes).
- **Source of truth**: HTML canonical + PM-JSON lossless sidecar *(chosen)* vs PM-JSON canonical + HTML as a derived export (rejected — breaks the viewer's HTML-serving contract, ADR-0038, and every non-editor upload path) vs no sidecar, re-parse HTML on every edit open (rejected — lossy, and defeats the point of a structured editing session).
- **Edit-save plumbing**: reuse the ADR-0037 upload pipeline *(chosen)* vs a parallel "draft" storage tier with its own promotion (rejected — duplicates scan/promote/versioning machinery for no product benefit) vs mutate-in-place (rejected — breaks immutable versioning, ADR-001's core value prop).
- **Event shape**: `origin` attribute on `ReportVersionUploaded` *(chosen)* vs a new `ReportEdited` event (rejected — registry bloat, duplicate consumers for identical downstream behavior).

## Consequences

- **Good**: no second versioning/scan/promotion system to build or maintain; the editor's export path is provably clean (zero editor attributes leak into the artifact); the generic attr-retention rule future-proofs new report styling without schema churn; the shell/body split bounds the schema-design surface and protects against arbitrary shell CSS/script.
- **Trade-offs**: every edit-save re-runs the full scan pipeline (latency cost accepted as the trust-boundary price); externally-uploaded reports pay a one-time best-effort parse cost on first edit, with no fidelity guarantee equal to editor-originated content; the custom `tableNodes` extension and the bare-inline-child normalization are real, if bounded, implementation work.
- **Neutral**: `report_versions` gains no new column — the sidecar is a same-prefix R2 object addressed by convention (`_source.json`), consistent with how the shell/body split and other version-scoped blobs are already stored.

## More information

- `spike/DECISION.md` (PR #144) — full spike evidence and schema v0 sketch; deleted upon this ADR landing (§8).
- `docs/adr/0037-report-upload-versioning-pipeline.md` — the pipeline edit-save reuses verbatim (R2-first/commit-last, `version_no` assignment, monotonic promote).
- `docs/adr/0038-report-viewer-access-serving.md` — viewer serving is unaffected; the exported HTML remains what it serves.
- `docs/events.md` — `ReportVersionUploaded` gains `origin`.
- Related: ADR-0060 (write grants — who may trigger an edit-save), ADR-012 (scan gate), ADR-024 (functional/immutable domain discipline), ADR-0065/0066/0067 (built on this schema).
