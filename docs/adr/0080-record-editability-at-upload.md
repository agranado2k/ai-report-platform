# ADR-0080: Record Editability at write time — a known state, not a discovered one

- **Status**: Accepted
- **Date**: 2026-08-06
- **Deciders**: agranado2k
- **Relates to / amends**: builds on ADR-0062 §2/§4 (the shell/body split and the `_source.json` sidecar — this ADR runs *their* predicate, it does not invent one) and ADR-0063 (in-viewer editing, whose loader is the code being mirrored); **does NOT amend ADR-0038** — the read path is an explicit non-goal here (§4); extends ADR-0065's per-version projection with one more field; follows ADR-0036 (a new term, in the glossary, same PR) and ADR-0024 (the application layer stays dependency-locked, hence a port); the write path it hooks into is ADR-0037/ADR-0039. Complementary to PR #247 (`fix/owner-lockout`), which fixes the *lockout*; this fixes the *unknowability*.
- **Superseded by**: —

## Context and problem statement

An operator's own private report could not be opened in the editor. It viewed perfectly. There was no error, no log line, and no way to ask the system what was wrong — just a redirect back to read-only. PR #247 diagnoses and fixes the lockout mechanics. This ADR is about the condition that made the lockout possible in the first place, which is a class problem rather than an incident:

**Uploads are stored verbatim, but the editor has a precondition on those bytes that nothing ever checks.**

`HtmlBundleProcessor.process` hashes the uploaded bytes and wraps them as `index.html`. It validates nothing about their structure, deliberately (ADR-0038's verbatim serving depends on exactly that). The viewer then streams them unchanged. But `apps/view/app/routes/$slug_.edit.tsx` requires `splitShell` to find a `<body>` boundary in those same bytes and — when the version has no `_source.json` sidecar, i.e. for **every uploaded-never-edited report** — requires `parseBody` to turn the result into a `reportSchema` document.

So an HTML **fragment** with no `<body>` — a perfectly normal thing for an agent to upload, and the single most likely accidental output of a generator asked for "a report" — views fine and cannot be edited. So does a document whose body defeats ProseMirror's recursive parse.

The consequences compound:

- **The user finds out by being redirected.** The affordance says "open"; the system says nothing and returns them to where they started.
- **Nobody can ask.** "Views fine, won't edit" was not a value in any column, on any wire shape, or in any log. It could not be counted, listed, alerted on, or explained. During the incident, telling `document-unreadable` from `document-unsplittable` from `document-unparsable` required a manual `curl` and a throwaway test file, because the system had never recorded which one it was.
- **An agent cannot self-correct.** MCP is this product's primary write surface. An agent that uploads a fragment gets a `201` and a `view_url`, and has no way to learn that what it just published is not editable — least of all in the one moment when re-uploading a full document would be trivial.

## Decision drivers

- The answer must come from the **editor's own code**, not a second predicate. A re-derived check (`html.includes("<body")`) is the bug class this repo keeps hitting: it agrees today and drifts the first time either function changes. PR #247 already had to correct one such approximation in its own diagnostic snippet.
- **The read path is untouchable.** ADR-0038's byte-for-byte serving is not negotiable; this must be metadata *about* the bytes, never a transformation *of* them.
- **Behaviour-neutral for everything that already exists.** A change that made existing reports appear un-editable would be a regression affecting the entire corpus at once.
- **Never a rejection.** "Views fine, won't edit" is a legitimate state. Making it visible must not make it forbidden.
- The application layer stays free of ProseMirror/linkedom (ADR-0024).

## Considered options

1. **Record the verdict on the version at write time, computed by the editor's own functions** *(chosen)*.
2. **Validate at upload and reject an un-editable document** — rejected. It breaks a working path (the report views), it breaks existing API clients, and it decides on the operator's behalf that a read-only report is not worth publishing. The upload endpoint's contract is "store these bytes", and this repo's answer to "an upload the platform doesn't like" has always been the scan pipeline's *quarantine*, not a synchronous 4xx on document shape.
3. **Compute it lazily, on first read** — rejected as the primary mechanism. It answers the same question one moment too late: the user is already on the redirect, and the agent has already gone. It also puts a linkedom+ProseMirror parse on a read path whose entire design property is that it does nothing to the bytes. (It remains available as a *backfill* strategy — see §3.)
4. **Derive it from the HTML with a cheap check at write time** (regex for `<body`) — rejected. This is a second implementation of a predicate that already exists, and it is wrong in both directions: a `</body>` inside an earlier script string passes the regex and still throws, and it says nothing at all about the parse leg.
5. **Log it and alert, but persist nothing** — rejected. A log answers "did this happen" for an operator reading logs; it does not answer "is THIS report editable" for the user looking at it, and it cannot be surfaced in a UI or an API.

## Decision outcome

Chosen: **option 1**.

### 1. One predicate, exported, called from both sides

`packages/report-html/src/editability.ts` exports `probeEditability(html, hasSourceDoc)`, returning `"editable" | "unsplittable" | "unparsable"`. It **calls** `splitShell` and then `parseBody` — the same two functions the `/edit` loader calls, in the same order — and converts their throws into an answer. It contains no re-derived conditions. This follows the precedent already set in the same package by `isDangerousUrl`, exported "so the editor's link-activation gate can reuse the SAME predicate rather than growing a second copy of it".

`hasSourceDoc` mirrors the loader's own branch: a version carrying a `_source.json` sidecar (every editor-authored save, ADR-0062 §4) loads that sidecar *instead of* parsing the body, so the parse leg cannot stop it and must not be held against it. Modelling this is what keeps the recorded verdict from lying about editor-origin versions.

### 2. Recorded on the version, in the ubiquitous language

**Editability** (glossary, this PR) is persisted as `report_versions.editability`, a nullable `version_editability` enum (`editable` / `unsplittable` / `unparsable`), migration `0021`. It is per-**version**, not per-report, because it is a fact about one set of bytes: a re-upload that breaks the editor must not retro-label the version that preceded it, and a re-upload that fixes it must not be reported as still broken. `upsertVersions` already refreshes only `scan_status` on conflict, so the value is written once and never rewritten.

The application layer reaches it through a new `EditabilityProbe` port, implemented in `packages/adapters` by `ReportHtmlEditabilityProbe`. A port rather than a direct call because `packages/application` is dependency-locked (ADR-0024) — the same reason `sourceDoc` is an opaque `Record<string, unknown>` there. It is called once in `uploadReport`, which means edit-saves are covered for free: `saveEditedVersion` is a wrapper over the same use case, not a second pipeline.

### 3. UNKNOWN is `null`, and the backfill is deliberately empty

Existing versions have no value, and **no migration can honestly give them one** — a migration cannot read R2. So `editability` is nullable with **no default**, and `null` means *nobody probed this*.

The alternative shapes were both wrong. Defaulting to `editable` asserts, for every pre-existing row, precisely the claim this ADR exists to stop assuming. Defaulting to `unsplittable` makes the entire existing corpus announce itself as broken. A one-off backfill job that fetches every entry document from R2 and probes it is *possible* and is the natural follow-up, but it is a data-plane operation with a cost profile of its own, and it is not required for correctness here.

**UNKNOWN is never treated as un-editable.** Nothing gates on the column: the editor keeps attempting and degrading exactly as it does today (PR #247's `document-unsplittable` / `document-unparsable` reasons). The dashboard says nothing for `null`. The wire shapes emit `null` explicitly rather than omitting the key, so a client can distinguish "unknown" from "editable" — collapsing those two is the guessing this field exists to end. The net behavioural change for every report that exists today is therefore **zero**, which is the property that made this shippable without an operator decision.

### 4. NON-GOAL: the read path does not change

This ADR adds no transformation, normalization, or validation to what the viewer serves. `HtmlBundleProcessor` still stores the uploaded bytes untouched; `$slug.tsx` still streams them; the probe only *reads* a decoded copy to answer a question. This is pinned by a regression test (`packages/adapters/src/editability-probe.test.ts`) that asserts byte-identity of the stored bytes across an editable, an unsplittable and an unparsable document — the three inputs on which a hypothetical "helpful" fixer would be most tempted to intervene.

Nor does it gate the editor. The dashboard's "Not editable" badge **explains**; the row still links to `/reports/{slug}/open`. A recorded verdict that suppressed the affordance would turn advisory metadata into authorization, and a stale or wrong verdict would then lock a user out of a report they can actually edit — reintroducing the incident from the other side.

**Reaffirmed 2026-08-06, with a concrete case** (`fix/unopenable-readonly`, ADR-0063 Phase 5-H). Production on `f83ed59` showed a private, `unsplittable` report whose owner could cycle indefinitely: `/unlock/{slug}` → `/reports/{slug}/open` → `/edit` → the 409 unopenable page → its bare `/{slug}` link → back to `/unlock/{slug}`. The tempting shortcut was to *route* on this column — send an owner of an `unsplittable` report straight to the read-only view and skip an editor hand-off that cannot succeed. It was **rejected**, and the cycle was closed by making the 409 page's link carry the owner fallback the route already held instead. Beyond the paragraph above, three further reasons specific to routing:

- **It would fix almost nothing.** `editability` is `null` for the entire pre-ADR-0080 corpus (§3), so a routing rule keyed on `unsplittable` would apply only to reports uploaded after this ADR shipped and leave every existing report in exactly the cycle that motivated the rule.
- **Write-time verdict, read-time question.** The column records what the probe concluded about one set of bytes when they were stored; whether the editor opens them is decided when it tries. Any drift between the two (a probe bug, a later `_source.json` sidecar, a parser change) becomes a wrong routing decision. The 409 page cannot make that mistake — it exists only because the editor *actually* failed, on those bytes, on this request.
- **One mint, one job.** `GET /reports/{slug}/open` is the single edit-token mint (ADR-0059 §4), and `/unlock` deliberately hands entitled visitors a link to it rather than deciding anything itself (`private-unlock.server.ts`). A content-shaped predicate inside that seam gives the authorization boundary a second, unrelated responsibility.

The general rule this leaves standing: **Editability is read by things that explain, never by things that decide.**

### 5. Surfaced where the answer is needed

- `VersionWire.editability` — per version, so version history shows which save broke or fixed the editor (`reports_list_versions`).
- `ReportWire.editability` — the **live** version's verdict, which is what "can I edit this report?" actually asks. Rides a 1:1 left join on `reports.live_version_id`, so listing a page costs no extra round-trip (`reports_get`, `reports_list`, `reports_search`, and the dashboard).
- The `201` upload response — so an agent learns at the moment of publishing. `reports_upload`'s MCP description says in words that `unsplittable` means a fragment was sent, that the report still views, and that `null` is unknown rather than un-editable.
- The dashboard row — a "Not editable" badge whose title names the reason *and the remedy*, decided server-side (`editabilityNotice`) following the `reportSharingBadge` doctrine: the server ships conclusions, the component renders them.

### 6. The e2e follows the hop this was invisible on

`tests/e2e/smoke/editor-auth.feature` asserted the `303` from `/{slug}/edit?et=…` and stopped, because the request *after* it needs a servable report and Cloudflare's scan-drain cron targets prod only. Every step of **both** production incidents (#188 and this one) happened on that next request. It is wired now: `preview-isolation.yml` and `e2e.yml` each derive the same per-PR `SCAN_DRAIN_SECRET` (HMAC-SHA256 of the PR's branch ref, keyed by an existing CI-only secret), branch-scoped so production is untouched and no new repo secret or operator action is needed. The scenario drives the drain, follows the 303, and asserts **200, not 302** — plus a negative scenario proving a fragment is accepted, reads back as `unsplittable`, and degrades rather than crashing.

## Consequences

**Good.**

- "Views fine, won't edit" is now a queryable state with a name, a column, a wire field, and a sentence in the UI.
- The next occurrence is diagnosable from the record instead of from a manual `curl` — the verdict distinguishes the two failure legs the incident could not.
- Agents self-correct at publish time rather than leaving an un-editable report behind.
- The e2e finally exercises the request both incidents occurred on, and a per-PR drain secret makes every future "needs a servable report" scenario cheap to write.

**Bad / accepted.**

- **Uploads pay a full linkedom + ProseMirror parse.** This is the cost of asking the real question rather than an approximation of it. It is bounded (one parse of one document, on a path already doing a SHA-256, an R2 write and a queue insert) and it cannot fail an upload — the probe is total, catching thrown values of every kind, including the `RangeError` from a deep recursive parse.
- **Existing versions stay UNKNOWN indefinitely** until re-uploaded. A backfill sweep is a named follow-up, not part of this change.
- **The dashboard/API answer can be stale** relative to what the editor would do today, if `splitShell`/`parseBody` change behaviour. Accepted because nothing gates on it: the runtime attempt remains the authority, and the field is advisory.
- **The e2e's derived drain secret couples two workflow files.** They must stay byte-identical. Mitigated by fail-closed behaviour — a drift produces a loud `401` from the drain, never a silent skip.

## Open follow-ups

- A one-off backfill that probes every live version's stored entry document and fills in `editability` (data-plane job, own change).
- ~~Render an explanatory page on `/edit` instead of the silent redirect~~ — **done**, PR #247 (`apps/view/app/edit/unopenable.ts`); this ADR's field is what it says.
- ~~Tighten the e2e negative to the owner-specific degrade (`?access=<oa>`)~~ — **done**, `fix/unopenable-readonly` (ADR-0063 Phase 5-H): the unopenable page's read-only link now carries the verified owner fallback, and `editor-auth.steps.ts` asserts `/{slug}?access=` in the deployed 409 body.

## More information

- Implementation: `packages/report-html/src/editability.ts` (the probe), `packages/adapters/src/editability-probe.ts` (the port implementation + the read-path regression pin), `packages/application/src/ports.ts` (`EditabilityProbe`), `packages/application/src/use-cases/upload-report.ts` (the one call site), `packages/db/drizzle/0021_report_versions_editability.sql`, `apps/app/app/server/editability-notice.server.ts` (the dashboard sentence).
- Schema contract: `docs/db-design.md` — `report_versions.editability` + the `version_editability` enum.
- Wire contract: `docs/api/openapi.yaml` — `UploadResult.editability`, `ReportSummary.editability`, `VersionSummary.editability`.
- Term: **Editability** in `docs/domain-glossary.md` (Reports & Folders context).
- e2e: `tests/e2e/smoke/editor-auth.feature` + `.steps.ts`; the drain wiring is documented in `tests/e2e/README.md` and lives in `.github/workflows/preview-isolation.yml` and `.github/workflows/e2e.yml`.
- Related incident write-ups: PR #247 (`fix/owner-lockout`), ADR-0063 Phase 5-H (`fix/unopenable-readonly` — the last hop of the same lockout, and the decision NOT to route on this column), and the 2026-08-06 diary entries.
