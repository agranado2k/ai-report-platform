# ADR-0060: Per-report write grants — supersedes folder collaborators

- **Status**: Accepted
- **Date**: 2026-07-06
- **Deciders**: agranado2k
- **Relates to / amends**: ADR-0059 (per-user ownership — this is the "owner allows others to write" half), **supersedes ADR-009 (folder-inherited write grants) and ADR-0056 P4 (folder collaborators)**, ADR-0016 (`acl:write` scope), ADR-0052 (External Ids), ADR-0053 (wire conventions), ADR-0057 (email — not required here; grants are silent, unlike allowlist magic links).

## Context and problem statement

With ADR-0059, only the owner can modify a report. The target model needs the owner to **explicitly grant write access to specific people**. The designed mechanism was folder-level: ADR-009 / ADR-0056 P4's `folder_collaborators` (editor/admin, cross-org, inherited down the folder tree) — schema-only, zero behavioral code. The operator chose per-report grants instead: simpler, matches the product model directly ("the owner allows others to write *on this report*"), and avoids tree-walk authorization cost.

## Decision drivers

- Match the product model exactly: the owner grants write on *a report*, not on a subtree.
- No dependency on unbuilt plumbing (P5 `UserCreated` outbox) — grants must work for not-yet-signed-up grantees today.
- Reuse the proven allowlist-grant machinery (`GrantStore` pattern, `EmailAddress`, revoke-by-row-delete).
- Keep authorization O(1) per check — no folder-tree walk on every write.

## Considered options

- **Per-report write grants** *(chosen)*.
- Folder-level collaborators as designed (rejected — inheritance complexity and tree-walk read cost for a sharing story that is report-centric; the folder tree becomes org-shared space under ADR-0059/0061 anyway).
- Both (rejected for now — per-report first; a folder layer can compose onto the same `canWrite` seam later if a real need surfaces).

## Decision outcome

1. **New table `report_write_grants`** (email-keyed, mirroring `report_grants`' shape and the old grantee pattern):
   `report_id uuid FK → reports ON DELETE CASCADE` · `grantee_email text` (normalized via `EmailAddress`) · `grantee_user_id uuid FK → users NULL` (resolved lazily) · `granted_by uuid FK → users` · `granted_at timestamptz` · **PK `(report_id, grantee_email)`** · index on `grantee_email`. No expiry (persists until revoked), no surrogate id (addressed as `(slug, email)` on the wire; a `grant_` External Id only if a standalone resource is ever needed).
2. **Email-based with lazy resolution, no event dependency.** The grantee may not have signed up yet. At check time the grant matches if `grantee_user_id = actor.userId` OR the grantee email equals the actor's user email; `grantee_user_id` is set opportunistically at grant time when the user exists. This deliberately does NOT depend on the P5 `UserCreated` outbox plumbing (only 3 domain events exist today) — backfilling `grantee_user_id` on `UserCreated` is a future optimization.
3. **One level, no `permission` column.** A write grant allows **rename, re-upload, move** — NOT delete, NOT `set_acl`, NOT grant management (owner-only, per ADR-0059). The `grant_level` enum stays unused rather than half-used; add levels only if they materialize.
4. **Authorization composes as `canWrite(report, actor) = isOwner OR hasWriteGrant`** — the seam ADR-0059 creates. Grant/revoke/list use cases are owner-only and require the `acl:write` scope (ADR-0016).
5. **Wire surface:** `POST /api/v1/reports/{slug}/collaborators` (grant), `DELETE /api/v1/reports/{slug}/collaborators/{email}` (revoke), `GET` (list — owner-only), following the ADR-0053 envelope; MCP tools `reports_grant_write` / `reports_revoke_write`. Errors RFC-9457 (ADR-0040).
6. **A write grant confers no view access by itself** on private modes — the grantee writes via the API/dashboard (org-visible metadata + owner-shared view paths). If a grantee needs to *view* a private report in the viewer, the owner shares it (allowlist) — deliberate separation of the read capability (Acl) from the write capability (grant).

## Consequences

- **Good:** direct fit to the product model; reuses the `GrantStore` port pattern, `EmailAddress` normalization, and revocation-by-row-delete semantics already proven by allowlist grants; no authorization tree-walk.
- **Trade-offs:** no inheritance — granting write on many reports is per-report work (acceptable; folder-level can layer on the same seam later); `folder_collaborators` + `grant_level` remain in the schema as dead weight until a cleanup migration drops them (expand/contract discipline — not dropped in this epic).
- **Supersession:** ADR-009 and ADR-0056's P4/P5 collaborator phases are superseded. `docs/adr/INDEX.md` records it; ADR-009 lives inline in `docs/spec.html`, so the spec carries a supersession note at the next spec revision (flagged in the diary per protocol).

## More information

Implementation: `WriteGrantStore` port modeled on `GrantStore` (`ports.ts`), Drizzle adapter + in-memory fake + port-contract suite (ADR-0046 tiers), `grantWrite`/`revokeWrite`/`listWriteGrants` use cases, the `canWrite` extension for `rename`/`reUpload`/`move`. Glossary: **Write grant** added; **Collaborator**/**Grant level** marked superseded.
