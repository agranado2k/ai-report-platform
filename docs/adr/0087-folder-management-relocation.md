# ADR-0087: Relocate folder management to a content-header panel, with writes over REST + fetcher

- **Status**: Accepted (2026-09-08) — supersedes-in-part ADR-0078 (the *surface* and the *write transport* of the folder-management controls; ADR-0078's authorization contract, invariants, and use cases are unchanged)
- **Deciders**: operator (design settled via `/grill-me` on #345)
- **Date**: 2026-09-08
- **Relates to / amends**: **ADR-0078** (relocates the surface it defined; retires the dashboard-action *intents*, keeps the use cases and the `acl:write` gate), ADR-0076 (**preserves §6** — a partial cascade must read as a warning, never a success), ADR-0075 (visibility-scoped listing unchanged; per-folder counts stay #343's grouped query), ADR-0086/0333-shell (the `_app` shell rail is the single folder-navigation surface), ADR-0079 (the editor-only browser tier still cannot mount `apps/app`, so the panel is covered by pure + node-render + e2e-against-preview), ADR-0060 (report-level sharing / `ReportSharingMenu` is untouched — that is #347's row surface)

## Context and problem statement

The 2026 app shell (#333/#344) gave the `_app` layout a folder-**navigation** rail.
But the dashboard body (`_app._index.tsx`) still rendered its own left `FolderTree`
column, which did **both** navigation (now duplicated by the rail) **and** the full
ADR-0078 **management** surface: the visibility badge, share-by-email, the share
roster, the counted cascade, the per-report bulk-apply, and inline rename/delete.
The result was two folder trees on one page — the transient state T4a (#334)
deliberately left for this ticket.

Removing the in-body tree is not a mechanical delete: it displaces a
sharing/visibility surface that carries real authorization and trust invariants
(the `acl:write` gate, the `shares === null` "never asked" distinction, the
`formKey` remount that stops a stale cascade tick surviving into the next state,
and ADR-0076 §6's partial-cascade-warns rule). Where that surface goes, how its
data loads, and how its writes flow are UX **and** security decisions, so the
design was settled through `/grill-me` before any code.

## Decision drivers

- **One navigation surface.** The rail navigates; the body must stop duplicating it.
- **Management belongs next to what it acts on.** Bulk-apply targets a folder's
  reports, so folder management reads best as a header over that folder's report list.
- **Do not pay for the roster you did not open.** The per-folder ACL roster is an
  expensive, sensitive query; it must stay lazy (today's `?manage=` laziness).
- **Snappy management, no full-page round-trip** (operator preference).
- **Preserve every ADR-0078 / ADR-0076 invariant** across the move.
- **Clean seam with #347** (the report-row interaction/sharing ticket) — no shared files.

## Considered options

1. **Content-header panel driven by `?folder=`, writes over REST + fetcher** (chosen).
2. Kebab management hung off each folder row in the shell rail — crowds a 256px rail
   and re-introduces a management surface inside the nav we just de-duplicated.
3. A dedicated per-folder route (`/folders/:id`) — cleanest separation but navigates
   away from the reports bulk-apply targets.
4. Keep the dashboard-action `<Form>` POST + redirect model and merely move the markup —
   every write is a full navigation that collapses a client-disclosed panel, and it
   drags the `?manage=` param back.

## Decision outcome

Chosen: **option 1**. Concretely:

- **Surface.** Per-folder management moves to a **content-header panel** for the
  selected folder; the shell rail becomes pure navigation and the in-body `FolderTree`
  is removed.
- **Selection.** `?folder=<id>` selects a folder and renders its header — name +
  visibility badge — from data already in the tree (cheap). **"Manage ▾" is a
  client-side disclosure**, not a navigation.
- **Read (lazy).** Opening "Manage ▾" fires a `useFetcher.load()` against the existing
  `GET /api/v1/folders/:id/shares`, extended with `?include=manage` to also return the
  cascade label and the bulk-apply context. The roster query runs **only** when
  management is opened; `shares === null` still means "never asked", distinct from an
  empty roster.
- **Writes (REST + fetcher island).** Each write is a `fetcher.submit` to the existing
  REST endpoint — share → `POST /shares`, unshare → `DELETE /shares/:email`,
  visibility/cascade → `POST /visibility`, rename → `PATCH /:id`, delete → `DELETE /:id`
  — plus a **new `POST /api/v1/folders/:id/apply-sharing`** wrapping the existing
  bulk-apply use case (the same one MCP's `folders_apply_sharing_to_reports` exposes).
  On success the panel re-fires the roster fetcher and resets its forms via fetcher
  state. **The dashboard's folder-management action intents are retired**
  (`share-folder`, `unshare-folder`, `set-folder-visibility`, `apply-folder-sharing`,
  `rename-folder`, `delete-folder`). Deleting the *selected* folder is the one write
  that navigates — to "All reports", with a mutation toast (ADR-0086/#336).
- **Outcome feedback (ADR-0076 §6 preserved).** Every REST write returns a **structured
  outcome** (`summary` / `partial` / `error` / refused set); the panel renders it in the
  success/warning/danger tones and raises the mutation toast. A partial cascade returns
  `partial: true` → **warning tone, data-driven**, never inferred from a re-read roster.
- **Root and the empty state.** No selection → no header (filter + the full report
  table, as today). **Root selected → its reports with the literal "Root" name hidden
  and no management chrome** (the domain refuses every visibility/share/rename/delete on
  Root; `manageable` is false). Manageable non-Root folders → name + badge + "Manage".
  The "Manage" affordance is gated on the same `manageable` / `acl:write` predicate as
  today.
- **Row seam (#347).** This ADR is folder-level only. `ReportSharingMenu` and the
  report-row interaction layer are **untouched** — that is #347's surface. The two
  sharing scopes coexist, visually distinct: folder sharing in the header, report
  sharing per row.
- **Tests (ADR-0079-aware).** Pure logic (the `?include=manage` payload shaping, the
  `manageable`/Root gating, the form-reset) is unit-tested; the panel markup is
  node-render smoke-tested; the **rewritten `folder-sharing.feature`** (ADR-0019 e2e
  against a live preview, a real browser where the fetcher works) is the interaction
  coverage. No `apps/app` browser tier is built here — that decision stays with #347.
  The e2e's `managedRow` helper loses its double-tree disambiguation once the in-body
  tree is gone.

## Consequences

- **Positive.** One navigation surface; management in context; the roster stays lazy;
  in-place, snappy management; the REST API becomes the single write path for folder
  management (the same seam MCP already uses), so behaviour is exercised by two callers.
- **Negative / cost.** A larger diff than a mechanical move: a new bulk-apply REST
  endpoint, a fetcher island, and an e2e rewrite. `apps/app` interaction still has no
  hermetic browser tier, so the fetcher read/write/cascade flow is only covered against
  a live preview (a known ADR-0079 gap). If the slice runs long it should split — the
  bulk-apply endpoint is the natural first tracer.
- **Invariants carried through, verbatim.** ADR-0078's `acl:write` gate and use cases;
  `shares === null` = never-asked; the `formKey` reset; ADR-0076 §6 partial-cascade-warns.
- **Supersedes-in-part ADR-0078**: only its *surface* and *write transport* change. Its
  authorization model, the bulk/inherited/read-write decisions, and its use cases stand.

## More information

Design settled via `/grill-me` on issue #345 (nine decisions, 2026-09-08). Part of
the app-shell redesign (PRD #330, App Shell Mockups report `Z0W60dI8hu`). The
report-row counterpart is #347; per-folder counts are #343.
