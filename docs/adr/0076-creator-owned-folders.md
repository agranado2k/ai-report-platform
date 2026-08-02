# ADR-0076: Creator-owned folders — visibility-scoped folder trees

- **Status**: Accepted
- **Date**: 2026-08-02
- **Deciders**: agranado2k
- **Relates to / amends**: ADR-0059 (**reverses** its §5 "folders stay org-scoped" decision), ADR-0075 (the report-side visibility model this mirrors), ADR-0060 (the email-keyed grant pattern `folder_shares` mirrors; ADR-009's `folder_collaborators` corpse stays superseded and is NOT reused), ADR-0037 (root folder as the default upload placement), ADR-0016 (`acl:write` scope), ADR-0036 (Reports & Folders).

## Context and problem statement

ADR-0059 §5 deliberately kept folders org-scoped: "a shared org folder tree is exactly what company orgs want." Team orgs went live (ADR-0068/0074), and reality disagreed — a House Numbers member created an "Engineering" folder via MCP and every other member sees it in their sidebar. Folder names and tree structure are themselves workspace metadata: what a colleague is working on, how they organize it. ADR-0075 established the sharper product model for reports ("the list shows only what the viewer may see"); folders were the remaining org-visible surface. The operator decided: **a folder is visible only to its creator unless shared with specific users or with the whole org.**

## Decision drivers

- **Existence is private** (the ADR-0075 driver, applied to folders): a folder's name — even the fact it exists — belongs to its creator until shared.
- No surprise disappearances at deploy: every pre-existing folder must stay exactly as visible as it is today.
- The Root folder must stay usable by every member (it is the default upload placement, ADR-0037).
- Mirror the proven mechanics: ADR-0075's predicate shape for listing; ADR-0060's email-keyed, lazily-resolved grant shape for shares.
- One predicate, enforced in the repository query — never post-filtered in the UI.

## Considered options

- **Creator-owned + visibility enum + email-keyed shares** *(chosen)*.
- Keep folders org-scoped (ADR-0059 §5 as written) — rejected: the incident is exactly the leak the model exists to prevent.
- Reuse the dormant `folder_collaborators` table (ADR-009) — rejected: it encodes a superseded design (folder-inherited WRITE grants with permission levels); shares confer visibility only. The corpse still awaits its cleanup migration (ADR-0060 trade-offs) and reusing it would resurrect its semantics by column-shape coincidence.
- Per-folder ACL modes like reports (password/allowlist/public) — rejected: folders are an organizing surface, not a content surface; two states (`private`/`org`) plus person-shares cover the product model.

## Decision outcome

1. **Schema (migration 0019).** `folders.owner_id uuid NULL` (FK users, RESTRICT; **NULL = legacy** pre-ADR-0076 row) and `folders.visibility` enum `private|org` NOT NULL. Backfill: every existing row → `visibility='org'`, owner stays NULL — preserving today's behavior exactly. The column default then flips to `'private'` (fail-safe for raw inserts; app code always writes an explicit value). New table `folder_shares` mirroring `report_write_grants` (ADR-0060): PK `(folder_id, grantee_email)` (normalized `EmailAddress`), `grantee_user_id` NULL resolved opportunistically at share time and matched by email at check time, `granted_by`, `granted_at`, FK cascade on folder delete.
2. **The visibility predicate.** A folder is visible to an actor iff `owner_id = actor` OR `owner_id IS NULL` (legacy) OR `visibility = 'org'` OR a `folder_shares` row matches (`grantee_user_id = actor` OR normalized-email equality — the exact `hasWriteGrant` dual match, ADR-0060 §2). Enforced in `FolderRepository.listByOrg`/`searchByOrg` (the sidebar tree, `GET /api/v1/folders`, MCP `folders_list`) and in the single-folder guards. The org-visibility leg is **org-context-relative**: callers establish the org scope first, so a cross-org write-grantee can still target the report org's org-visible folders on move (today's behavior).
3. **Defaults + inheritance.** A new folder is owned by its creator. Its visibility at creation: **`private` when created under the Root** (private-by-default — the Root's own `org` visibility is a usability invariant, not a sharing intent), **else the parent's visibility** (a child created inside an org-shared subtree stays org-shared). **Root folders are always `org`** — enforced in code (provisioning writes it explicitly; `setFolderVisibility` rejects **any** visibility call on a Root with 422) because every member's default uploads land there. Rejecting only Root→private would leave Root→**org** as a folder-seizure: a Root is a legacy row (`owner_id` NULL), so the adoption leg of §6 would hand the caller permanent ownership of everyone's default upload placement and 403 every other member out of managing it. Re-asserting `org` on a Root changes nothing, so refusing it costs nothing: **the Root is not a manageable folder.**
4. **Write semantics unchanged in spirit.** Shares grant **visibility only**. Rename / delete / create-children require: same org AND (`owner` OR legacy OR org-visible) — i.e. today's "anyone in the org" behavior survives for legacy and org-visible folders; a private folder is writable only by its owner. Denial shape: an **invisible** same-org folder reads as **404 NotFound** (existence is private, the ADR-0075 principle); a visible-but-not-writable one reads 403; cross-org keeps the historical 403. `deleteFolder`'s emptiness guards (`hasReportsInFolder`, new `hasChildFolders`) are deliberately NOT visibility-scoped — an invisible report or subfolder still blocks the delete, and a bare boolean leaks nothing.
5. **Partial-visibility tree rendering.** A visible folder whose ancestor chain contains invisible folders is **grafted under Root** in that viewer's tree (pure helper `graftOrphansToRoot`, arp-domain) — reachable, with no invisible ancestor's name leaked. A visible report living in an invisible folder is grouped under Root's label on the dashboard (its wire `folder_id` is left as-is — the API never resolves names through it). On the flat API/MCP list the dangling `parent_id` is likewise left as-is (an opaque id, not a name); tree-building clients graft the same way.
6. **Sharing management surface.** `setFolderVisibility` / `shareFolder` / `unshareFolder` / `listFolderShares` are **owner-or-legacy only** and gate on the **same `acl:write` scope as report sharing** (sharing is sharing — no new scope). On a **legacy folder, `setFolderVisibility` ADOPTS**: the caller becomes `owner_id` (the repair path — e.g. making the incident's "Engineering" folder private assigns it to whoever runs the call). Share/unshare on a legacy folder do NOT adopt (adoption is the explicit visibility act). Wire: `POST /api/v1/folders/{id}/visibility`, `GET|POST /api/v1/folders/{id}/shares`, `DELETE /api/v1/folders/{id}/shares/{email}`; MCP `folders_set_visibility` / `folders_share` / `folders_unshare` / `folders_list_shares`. `FolderWire` gains `visibility` + `owner` (a `user_…` id, null = legacy). Dashboard share UI is a follow-up issue — API + MCP only in this iteration.

## Consequences

- **Good:** the ADR-0075 privacy model now covers the last org-visible listing surface; the backfill makes the deploy behavior-neutral; the contract suite carries the executable folder visibility matrix on both runners; the incident has a one-call repair.
- **Trade-offs:** the folder listing gains an EXISTS probe on `folder_shares` (indexed, cheap at current scale); "anyone can manage a legacy folder" is a deliberately wide adoption window that narrows to owner-only the moment someone adopts; a share grants visibility of the folder's NAME and position only — reports inside stay governed by their own `Acl`s (deliberate separation, mirroring ADR-0060 §6).
- **Flagged (pre-existing, not fixed here):** `POST /api/v1/reports`'s documented `folder_path` placement is parsed but **silently ignored** by the route (every create lands in the actor's Root) — so upload-time folder targeting needed no visibility work in this iteration; when `folder_path` resolution is actually implemented it MUST resolve only actor-visible folders, and path segments it creates are owned by the actor (private) per §3. Tracked as a follow-up issue.
- **Flagged:** `folder_collaborators` + `grant_level` remain dead schema awaiting their cleanup migration (unchanged from ADR-0060) — now alongside the live `folder_shares` table; the cleanup must not confuse the two.

## Amendment (2026-08-02) — the deferred dashboard UI shipped, plus an opt-in cascade

§6 closed with "Dashboard share UI is a follow-up issue — API + MCP only in this iteration" (issue #231). That UI has now shipped, and building it surfaced one gap in the model worth recording.

1. **The management surface is the sidebar.** Every non-Root folder row carries a visibility badge (`Private` / `Org` / `Shared with N`) and a `<details>` kebab — the same idiom the report rows already use — holding the private ⇄ org toggle, the share roster (email + granted-at), add-by-email, per-row remove, and the legacy-adoption warning. It posts to the dashboard's **cookie-authenticated Remix action**, which calls the same four use cases; the browser never touches the Bearer `/api/v1` routes. A session carries `SELF_SCOPES`, so the `acl:write` gate in §6 is satisfied without a new door.
2. **Root renders nothing.** §3 makes the Root unmanageable in *either* direction, so the sidebar renders no affordance for it at all rather than rendering-then-erroring.
3. **The rule is mirrored, never re-derived.** `manageable` / `blockedReason` / `adoptionNotice` are computed in the LOADER by `folderManagement` (`apps/app/app/server/folder-sharing.server.ts`), a mirror of `loadManagedFolder`, and shipped to the components as plain data. Two reasons: the dashboard components must not import `arp-domain` (its barrel pulls `node:crypto` into the client bundle), and an independently-invented client rule would drift from the server that actually decides. A folder owned by someone else renders the controls **disabled with the server's own reason**, not hidden.
4. **The adoption warning arrives before the click.** Adoption (§6) is permanent and has no transfer path, so a legacy folder's menu states it up front: "You'll become this folder's owner. Other members won't be able to change its sharing, and ownership can't be transferred."
5. **The share roster costs one query, for one folder.** Only `?manage=<id>` loads a roster; every other badge falls back to `Private`/`Org` rather than inventing a count it never fetched. A roster per sidebar row would be an N+1 on the dashboard's hot path.

### The nested-folder gap, and why the cascade stayed a UI-layer loop

**The gap.** This ADR's repair is per-folder and NOT recursive. Making a parent `private` leaves pre-existing descendants `org` — and §5's `graftOrphansToRoot` then re-parents those descendants under Root in every other member's sidebar. So the names still leak, from a folder whose owner has just been told it is private. The per-folder model is right (a descendant may have its own owner and its own intent), but "make this private" without a way to reach what is inside it is a half-repair.

**The decision.** The UI adds an explicit, clearly-labelled opt-in — "Also apply to everything inside this folder" — implemented in the **action layer** as a loop over `collectFolderDescendants` (a pure, cycle-safe tree walk in `arp-domain`, next to `graftOrphansToRoot`) that calls the **existing `setFolderVisibility` use case once per folder**.

**Why not recursive domain or SQL semantics:**

- Every iteration re-runs `loadManagedFolder`, so a descendant the actor does not own is refused by exactly the same authorization path it would hit on its own. A recursive SQL `UPDATE` would have to re-implement that gate — the classic place an authorization bypass gets introduced.
- Per-folder ownership is the model. A recursive transition would have to decide, in the domain, what happens to a descendant someone else owns; the loop doesn't decide — it asks, and reports the answer.
- Each folder still gets its own `folder.visibility_set` audit row (ADR-0070), with its own `adopted` flag. One recursive statement would collapse that to a single, less truthful record.

**Consequences, accepted:**

- **Partial failure is normal, and is reported honestly.** The banner names every folder that changed and every folder that did not, with the server's own reason for each, and never counts a refusal as a success (`cascadeSummary`, unit-tested for exactly that).
- **Scope is the actor's VISIBLE tree.** A descendant the actor cannot see is not in the tree the loop walks, so it is never silently "skipped" — it was never a candidate. This is the one limit the per-folder copy can't spell out row by row, and it is the deliberate consequence of "existence is private": the UI cannot warn about a folder it must not admit exists.
- **It is N calls, not one.** Fine at current folder counts, and each one is the audited, authorized call it should be. If a tree ever gets deep enough for this to matter, the fix is a batched *use case* — not recursive SQL underneath the guard.

## More information

Implementation: predicate in `DrizzleFolderRepository` (owner/legacy/org legs + EXISTS on `folder_shares`), mirrored by `InMemoryFolderRepository` (shared `FolderShareStore` instance); guards `loadVisibleFolder`/`loadWritableFolder`/`loadManagedFolder` replace `loadOwnedFolder`; matrix tests in `folder-repository.contract.ts` + `folder-share-store.contract.ts` run against both runners (ADR-0046). Glossary: **Folder** sharpened; **Folder share**, **Folder visibility** added.
