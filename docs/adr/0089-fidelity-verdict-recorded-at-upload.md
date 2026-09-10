# ADR-0089: Fidelity — record at write time whether the editor would KEEP a ReportVersion's bytes

- **Status**: Accepted
- **Date**: 2026-09-10
- **Deciders**: agranado2k
- **Relates to / amends**: **amends ADR-0080** (which records *editability*, the editor's open-time precondition; this adds a second, orthogonal verdict computed at the same moment, through the same port, in the same call site) and inherits its whole shape — the probe calls the editor's own functions, the application layer reaches it through a port (ADR-0024), `null` means *never probed* and there is no backfill. Builds on ADR-0062 §2/§4 (the `Presentation shell` / `Editable body` split and the `_source.json` sidecar — an editor-origin version is lossless *by construction*, which is a fact this ADR reads out of ADR-0062 rather than a rule it invents) and ADR-0063 (the editor whose schema decides what survives). Extends ADR-0065's per-version projection with one more field. Follows ADR-0036 (a new term, in the glossary, same PR). **Does NOT amend ADR-0038** — the read path is untouched, exactly as in ADR-0080 §4. Part of PRD #356 (owner view + artifact parity).
- **Superseded by**: —

## Context and problem statement

ADR-0080 asked "**can** the editor open these bytes?" and made the answer a recorded fact. It did not ask the question that turns out to matter more often:

**When the editor opens a document successfully, it may still not keep it.**

An operator published a self-contained slide deck — inline CSS, inline JavaScript, inline SVG diagrams, `<section class="slide">` elements toggled with the `hidden` attribute. Its editability verdict is `editable`: `splitShell` finds the body, `parseBody` returns a `Report HTML schema` document, no throw. Every affordance in the product therefore says "open this in the editor". But the `Report HTML schema` is a *document* schema, not an HTML superset: it drops `<script>`, flattens `<svg>` to text, and (until PR #368) stripped `class` off `<section>`. Opening that deck in the editor and saving would publish a ReportVersion with the deck's interactivity silently deleted.

So `editable` is not the reassurance it reads as. The gap between the two questions is invisible in exactly the way ADR-0080's gap was:

- **The user cannot ask.** "Opens, but drops your scripts" is not a value in any column, on any wire shape, or in any log. It is not the same as `unparsable`, and forcing it into the editability enum as a fourth value would be a category error: a document can be simultaneously openable and lossy, and those are two independent bits, not four points on one axis.
- **The affordance cannot warn.** An Edit button cannot say what a save would destroy, because nothing has ever computed it.
- **An agent cannot self-correct.** MCP is the primary write surface. An agent that publishes a script-driven report gets a `201` and a `view_url`, with no way to learn that this document is view-only content in practice.

ADR-0080 already built the machinery for exactly this shape of question — a total probe over the stored bytes, run once at write time, recorded on the ReportVersion, advisory and never gating. What is missing is the second question.

## Decision drivers

- **A different question needs a different field.** Editability and fidelity are orthogonal: `editable` + `lossy` is the interesting case, and it is unrepresentable if fidelity is squeezed into the editability enum. ADR-0080's enum is the editor's *open-time precondition*; overloading it would make both values mean less.
- **The answer must come from the editor's own code.** The ADR-0080 driver, unchanged: a re-derived predicate (`html.includes("<script")`) agrees today and drifts the first time the schema changes. The probe must *call* `parseBody` and the serialiser and compare, so the answer tracks the schema automatically — PR #368 changing `<section class>` retention should change verdicts with no edit to this probe.
- **The comparison must not be byte equality.** A round trip legitimately reorders attributes, normalises entities, re-indents, and rewrites `<br/>` as `<br>`. Byte equality would mark every document lossy and the field would carry no information. What counts as loss is *content* loss: an element, an attribute or a script that no longer exists.
- **The read path is untouchable.** ADR-0038's byte-for-byte serving is not negotiable. This is metadata *about* the bytes.
- **Behaviour-neutral for everything that exists.** Nothing gates on the verdict; existing ReportVersions must not be mislabelled.
- **The application layer stays free of ProseMirror/linkedom** (ADR-0024), hence a port.

## Considered options

1. **A second nullable per-ReportVersion enum, `fidelity`, probed at write time by a round-trip through the editor's own parse and serialise** *(chosen)*.
2. **A fourth editability value, `lossy`** — rejected. It makes the enum answer two questions at once and destroys the one combination that matters (`editable` + `lossy`); a document that is `unsplittable` has no fidelity answer at all, and one that is `editable` has both. Two bits do not fit in one enum without losing a state.
3. **Compute it lazily, when the Edit affordance is rendered** — rejected as the primary mechanism, for ADR-0080 §3's reasons plus one more: the confirm dialog is not the only consumer. The API and the dashboard want the answer without a parse per page render, and an agent wants it at publish time, when it still holds the document and can fix it.
4. **Byte-compare the round trip** — rejected. Every real document would be `lossy` (see the drivers), which is the same as having no field.
5. **A hand-written list of "risky" tags** (`script`, `svg`, `iframe`, `canvas`) matched with a regex — rejected: this is ADR-0080's rejected option 4 in a new costume. It is a second implementation of the schema's own drop rules, wrong in both directions (a `<script>` inside a comment, a custom element the schema happens to keep), and it goes stale silently the moment the schema changes.
6. **Record only the boolean, not what was lost** — rejected. The verdict's whole purpose downstream is an affordance that can *name* what a save would destroy; "this edit is lossy" without a subject is an alarm nobody can act on. The lost items cost nothing extra to collect — the comparison already knows them.

## Decision outcome

Chosen: **option 1**.

### 1. One probe, beside the other one, calling the editor's own functions

`packages/report-html/src/fidelity.ts` exports `probeFidelity`, which takes the uploaded HTML and whether the ReportVersion carries an editor source sidecar, and returns a verdict plus the lost items. It **calls** `splitShell`, `parseBody` and the editor's serialiser — the same functions the `/edit` loader and the save path call — and compares the serialised body to the uploaded body. It re-derives no schema condition, exactly as `probeEditability` re-derives no loader condition. The two probes sit side by side in the same package for the same reason: the predicate lives once, where the editor's code is reachable.

The comparison runs through a **normaliser** that removes the differences a round trip is *entitled* to make: insignificant whitespace, attribute order, entity encoding, and self-closing forms. What survives normalisation is real content loss. The probe reports it as **lost items** — element names and attribute names, deduplicated — which is what an affordance can put in a sentence.

### 2. Two orthogonal gates, in a fixed order

The probe answers only when the question is meaningful:

- **A ReportVersion with a `_source.json` sidecar is `lossless`, without parsing anything.** Its body was *produced* by serialising the editor's own document (ADR-0062 §4), so the round trip is the identity by construction. Parsing it to rediscover that would be slower and could only introduce a false negative. This is the fidelity twin of ADR-0080 §1's `hasSourceDoc` branch, and it is what stops the verdict lying about editor-authored ReportVersions.
- **Otherwise, fidelity is probed only when editability is `editable`.** For `unsplittable` or `unparsable` bytes there is no round trip to run and no honest answer to give: the editor never gets far enough to keep or drop anything. Those ReportVersions keep `fidelity: null`, which is the same UNKNOWN the corpus already uses.

### 3. Recorded on the ReportVersion, written once

**Fidelity** (glossary, this PR) is persisted as `report_versions.fidelity`, a nullable `version_fidelity` enum (`lossless` / `lossy`), migration `0023`. Per ReportVersion, not per report, for ADR-0080 §2's reason: it is a fact about one set of bytes, and a re-upload must not retro-label its predecessor. `upsertVersions` refreshes only `scan_status` on conflict, so the value is written once and never rewritten.

The application layer reaches it through a `FidelityProbe` port implemented in `packages/adapters`, because `packages/application` is dependency-locked (ADR-0024). It is called once, in `uploadReport`, beside the editability call — which means **edit-saves are covered for free**: `saveEditedVersion` is a wrapper over the same use case, not a second pipeline, and such a save arrives carrying a sidecar and is recorded `lossless` by §2's first gate.

### 4. UNKNOWN is `null`, and there is no backfill

Identical to ADR-0080 §3, for identical reasons: a migration cannot read R2, so it cannot honestly give an existing row a verdict. The column is nullable with **no default**. `null` means *nobody probed this* — never "lossless", which would assert for the whole pre-0089 corpus precisely the claim this field exists to stop assuming.

`null` is emitted explicitly on the wire rather than omitted, so a client can tell UNKNOWN from `lossless`. A backfill sweep is a named follow-up, not part of this change.

### 5. NON-GOALS: the read path, and gating

No transformation, normalisation or validation is added to what the viewer serves. The probe reads a decoded copy to answer a question; `HtmlBundleProcessor` still stores the uploaded bytes untouched.

And, inheriting ADR-0080 §4's general rule unchanged: **fidelity is read by things that explain, never by things that decide.** Nothing gates on it. A lossy ReportVersion is still editable, still openable, still saveable — the affordance that eventually warns about it (PRD #356's Edit confirm dialog) *explains and proceeds*, and a wrong or stale verdict must never be able to lock a user out of their own report. An upload is never rejected for being lossy: "view-only content" is a legitimate, first-class thing to publish, and the upload endpoint's contract remains "store these bytes".

### 6. Surfaced next to editability

`fidelity` joins `editability` everywhere editability already is on the read surfaces this change owns: the ReportVersion projection (so version history shows which save changed the answer), the report resource for the live ReportVersion, and the HTTP API's report read, versions list, and content read. The consumers that *act* on it — the upload response warnings, the MCP tool fields, the dashboard hint and the Edit confirm dialog — are deliberately **not** in this change; they are separate tickets (PRD #356) so that the recorded fact lands, and is reviewable, before anything is built on top of it.

## Consequences

**Good.**

- "Opens in the editor, but would delete your scripts" is now a queryable state with a name, a column, a wire field and a list of what would be lost.
- The verdict tracks the editor's schema automatically: a change to what the schema retains changes future verdicts with no edit to the probe. PR #368's `<section class>` fix is the first such case.
- The Edit confirm dialog, the dashboard hint and the upload warnings can all be built against a fact that already exists, instead of each computing their own.
- Editor-origin ReportVersions are answered without a parse, which is both faster and immune to false negatives.

**Bad / accepted.**

- **Uploads pay a second parse plus a serialise**, on top of ADR-0080's parse. Bounded (one document, on a path already doing a SHA-256, an R2 write and a queue insert), skipped entirely for editor-origin ReportVersions and for non-`editable` ones, and it cannot fail an upload — the probe is total and catches thrown values of every kind, defaulting to UNKNOWN.
- **The normaliser is a judgement call.** Too aggressive and it hides real loss; too literal and everything is lossy. It is pinned by fixtures on both sides — the plain reports must come out `lossless`, the deck must come out `lossy` with `script` and `svg` named — and it is the one part of this change that will need revisiting as the schema evolves.
- **Existing ReportVersions stay UNKNOWN indefinitely** until re-uploaded.
- **The recorded answer can go stale** relative to the schema of the day, exactly as editability can (ADR-0080's "recorded-at-write means it can go stale"). Accepted for the same reason: nothing gates on it, and the runtime attempt remains the authority.

## More information

- Implementation: `packages/report-html/src/fidelity.ts` (the probe + the normaliser), `packages/adapters/src/fidelity-probe.ts` (the port implementation), `packages/application/src/ports.ts` (`FidelityProbe`), `packages/application/src/use-cases/upload-report.ts` (the one call site), `packages/db/drizzle/0023_report_versions_fidelity.sql`.
- Schema contract: `docs/db-design.md` — `report_versions.fidelity` + the `version_fidelity` enum.
- Wire contract: `docs/api/openapi.yaml` — `ReportSummary.fidelity`, `VersionSummary.fidelity`, `ContentResult.fidelity`.
- Term: **Fidelity** in `docs/domain-glossary.md` (Reports & Folders context).
- Amends: `docs/adr/0080-record-editability-at-upload.md` — this record adds the second verdict; ADR-0080's own decisions stand unchanged.
- Ticket #362, PRD #356.
