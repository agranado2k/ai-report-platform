# ADR-0065: Version history & visual diff

- **Status**: Accepted
- **Date**: 2026-07-07
- **Deciders**: agranado2k
- **Relates to / amends**: builds on ADR-0062 (editing model & Report HTML schema — the `_source.json` sidecar this ADR diffs), ADR-0037 (upload pipeline — the `ReportVersion` history being listed), ADR-0038 (viewer `?v=N` — unchanged), ADR-0051 (MCP server — thin-client tool pattern), ADR-0053 (wire conventions, cursor pagination), ADR-0059/0060 (ownership/write-grant auth this endpoint reuses).

## Context and problem statement

`ReportVersion`s already exist as an append-only history (ADR-0037), and the viewer already serves any of them via `?v=N` (ADR-0038), but there is no way for an owner (or an authorized collaborator) to **discover** that history — the version count and metadata are invisible outside direct enumeration of `?v=N` — and no way to **see what changed** between two versions. With ProseMirror as the editing engine (ADR-0062) and `_source.json` as a per-editor-originated-version lossless sidecar, a structural, word-level diff becomes possible for the first time; before ADR-0062 the only diff available would have been a raw-HTML-text diff, useless for reviewing a content edit. This ADR decides the read surface for version history and the mechanism for visual diff, for both editor-originated and externally-uploaded versions.

## Decision drivers

- **Discoverability without enumeration** — an owner should not have to guess `?v=N` values to see a report's edit history.
- **Reuse the existing auth seam** — version history is per-report data; it must respect the same org/ACL scoping as every other single-report read (ADR-0059 §3).
- **Diff quality where possible, honest degradation where not** — editor-originated versions have a lossless structured source; externally-uploaded ones don't, and the UI must say so rather than fake equivalent fidelity.
- **No new storage artifact for a read-only view** — a diff is computed on demand from data already persisted, not materialized and stored.
- **MCP parity** — agents need the same version-discovery capability dashboards get (ADR-0051's thin-client pattern).

## Decision outcome

### 1. New read endpoint: `GET /api/v1/reports/{slug}/versions`

Lists a report's `ReportVersion`s as a cursor-paginated list envelope (`{ object: "list", data, has_more }`, ADR-0053), newest-created first, using the same `limit` / `starting_after` / `ending_before` query parameters as `listReports`/`listFolders`. Each item carries: `version_no`, the version's External Id, `uploaded_by` (a `user_…` External Id), `uploaded_at`, `scan_status`, `size_bytes`, and `origin` (`'upload' | 'editor'`, ADR-0062 §6).

Auth: identical to single-report GET (ADR-0059 §3) — org-scoped, plus the write-grantee metadata carve-out. A session with no active organization, or a report outside the actor's org and without a write grant, is denied the same way single-report GET is today. This is a **read** endpoint; it grants no new write capability and does not require `acl:write`.

### 2. MCP tool `reports_list_versions`

A thin client over the endpoint above, following the ADR-0051 pattern (`reports_search`/`reports_get_acl` precedent): the tool `fetch`es `/api/v1/reports/{slug}/versions` with the caller's forwarded credential and returns the same list shape. MCP writes and reads are always authenticated — there is no anonymous MCP path, matching every other tool in the catalog.

### 3. Visual diff: prosemirror-changeset over doc JSON, with a DOM-diff fallback

Given two versions, both carrying an ADR-0062 `_source.json` sidecar, the diff is computed by running **`prosemirror-changeset`** over their PM document JSON, producing word-level insert/delete decorations rendered inline in the dashboard (spike-proven mechanism, `spike/DECISION.md`). This is the common case for any pair of versions where at least the more recent one was produced by the in-app editor.

When either side of the comparison lacks a sidecar — most commonly an externally-uploaded version that was never opened in the editor — the diff falls back to a **best-effort DOM-level diff** of the rendered HTML, clearly labeled in the UI (e.g. "structural diff unavailable — showing raw HTML comparison") so the lower fidelity is never presented as equivalent to the structured diff.

The diff is **read-only UI**, surfaced on the dashboard (and, later, the viewer) — it is not a new storage artifact. Nothing is persisted as a result of viewing a diff; it is recomputed from the two sidecars (or two HTML blobs) on each request.

### 4. Diff-on-re-upload

When a new version arrives via a plain upload (not the editor), the dashboard can show the visual diff against the previous live version using the identical mechanism from §3 — if both sides have sidecars, structural diff; otherwise, the DOM-level fallback. This gives upload-only users (who never touch the editor) the same "what changed" visibility, at whatever fidelity the available data supports.

### 5. Viewer `?v=N` behavior: unchanged

ADR-0038's `?v=N` access model is untouched by this ADR — the new `/versions` endpoint is purely a **discovery** aid for the dashboard/MCP side; it does not change how the public viewer resolves or gates non-live versions.

## Considered options

- **Version discovery**: new dedicated `/versions` list endpoint *(chosen)* vs embedding the full version list on single-report GET (rejected — bloats the common-case report fetch with history most callers don't need; ADR-0053's `ReportSummary` projection principle argues against it) vs client-side `?v=N` enumeration (rejected — no way to know the upper bound, and it's the exact gap this ADR closes).
- **Diff mechanism**: `prosemirror-changeset` over PM doc JSON *(chosen, spike-proven)* vs raw-HTML text diff for all versions (rejected — line/character-level HTML diff is unreadable for a content reviewer and was never spike-tested for readability) vs re-parsing HTML into PM doc JSON on every diff request even when a sidecar exists (rejected — throws away exactly the lossless structure ADR-0062 introduced the sidecar to preserve).
- **Fallback for sidecar-less versions**: best-effort DOM diff, clearly labeled *(chosen)* vs refusing to diff at all when either side lacks a sidecar (rejected — externally-uploaded reports are common and a total refusal is a worse UX than a labeled lower-fidelity view) vs silently treating it the same as the structured diff (rejected — misrepresents fidelity to the user).

## Consequences

- **Good**: version history becomes a first-class, paginated, authorization-consistent read surface instead of an enumeration exercise; the diff reuses the exact mechanism the spike proved out, with no new storage cost; MCP agents get parity with the dashboard.
- **Trade-offs**: the spike's `prosemirror-changeset` integration fragments diffs into partial ranges (word-level LCS) rather than clean semantic hunks, and renders deletions as widget annotations rather than strikethrough-in-place — an accepted UI constraint of the library, not a bug to fix in this epic. The DOM-diff fallback is deliberately lower-fidelity and must stay visibly labeled as such so it's never mistaken for the structured diff.
- **Neutral**: no schema change — `/versions` projects existing `report_versions` columns plus the ADR-0062 sidecar's presence/absence; the diff endpoint (if implemented as its own route) or in-dashboard computation reads two existing R2 objects and produces no new persisted state.

## More information

- `spike/DECISION.md` (PR #144, deleted per ADR-0062 §8) — the `prosemirror-changeset` proof (word-level insert/delete, spike-verified).
- `docs/adr/0062-editing-model-report-html-schema.md` — the `_source.json` sidecar this ADR diffs, and the `origin` attribute surfaced in the version list.
- `docs/adr/0037-report-upload-versioning-pipeline.md` — the `ReportVersion` history and `version_no`/`scan_status` fields projected here.
- `docs/adr/0038-report-viewer-access-serving.md` — `?v=N`, unaffected.
- `docs/adr/0051-mcp-server.md` — the thin-client tool pattern `reports_list_versions` follows.
- `docs/api/openapi.yaml` — cursor-pagination parameters (`limit`, `starting_after`, `ending_before`) and the `ReportList`/`FolderList` envelope shape this endpoint's `VersionList` schema will match.
