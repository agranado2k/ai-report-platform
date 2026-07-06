# ADR-0059: Per-user report ownership — the creator is the owner

- **Status**: Accepted
- **Date**: 2026-07-06
- **Deciders**: agranado2k
- **Relates to / amends**: ADR-0056 (report sharing & ACLs — **amends** its "owner = any member of the owning org" decision), ADR-0048 (JIT personal-org provisioning), ADR-0054 (user soft-delete — interaction flagged below), ADR-0036 (DDD — `Report` aggregate), ADR-005 (orgs-from-day-1 tenancy, unchanged).

## Context and problem statement

Today a `Report` is owned by its `Org`: the row carries `org_id` and no user reference (beyond the per-version `uploaded_by_user`), and every write path checks `report.orgId === actor.orgId` (`loadOwnedReport`). ADR-0056 codified "owner = any member of the owning org" — including the `/reports/{slug}/open` owner-token mint that bypasses every share gate. With today's 1:1 single-member personal orgs (ADR-0048) this is indistinguishable from per-user ownership. But the target product model is: **a report is private to the person who created it, even inside a company org** — colleagues see it exists, but cannot open, edit, or re-share it unless the owner shares it. Org-scoped ownership makes every future org member a full co-owner, which forecloses that model. The decision must land **before** multi-member orgs exist (ADR-0061), while it is still behavior-neutral.

## Decision drivers

- "Private by default, only accessible by the owner" must hold inside a company org, not just across orgs.
- One consistent rule for personal and company orgs (no dual model to maintain).
- Ship while all orgs are single-member, so the change is provably behavior-neutral in production.
- Keep org-scoped tenancy (quota, billing, listing, folders) intact — ownership is a permission concept, not a tenancy change.

## Considered options

- **Creator is owner, all orgs** *(chosen)* — `reports.owner_id` = the user who created the report.
- Per-user ownership only in multi-member orgs (rejected — two rule sets, and personal-org reports silently change semantics when an org grows).
- Configurable per org (rejected — most complexity, no current need).
- Org admins retain view access to members' private reports (rejected — the operator chose owner-only literally; admins see list metadata, never content).

## Decision outcome

1. **`Report.ownerId` (new, required).** The user who created the report (`uploadReport`'s actor) is its owner, in every org type. Persisted as `reports.owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT`, backfilled from `report_versions.uploaded_by_user` at `version_no = 1` (NOT NULL; every report has a v1 created atomically in `createReport` — and in today's single-member orgs the v1 uploader *is* the sole member).
2. **Writes are owner-gated.** `rename`, `delete`, `move`, `re-upload`, and `set_acl` require `report.ownerId === actor.userId` (after the existing org check — same-org non-owner ⇒ 403 `NotAllowed`, cross-org ⇒ 404 as today). The write guard becomes a `canWrite` seam that ADR-0060's write grants extend for `rename`/`re-upload`/`move`; `delete` and `set_acl` (and grant management) stay owner-only permanently. Note `reUpload`'s org check is inline in `upload-report.ts`, NOT inside `loadOwnedReport` — it moves to the same seam.
3. **Reads stay org-visible (metadata).** Lists/search (`searchByOrg`) and single-report GET remain org-scoped — org members (and org admins) see that a report exists, its title/slug/folder, but content access is decided by the viewer per the `Acl`. The ACL sub-resource GET (`/reports/{slug}/acl`) becomes **owner-only** — allowlist emails and share config are the owner's business.
4. **The `owner` access token is minted only for the owner.** `/reports/{slug}/open` gates on `ownerId === actor.userId`, not on org-scoped `getReport`. This is the security keystone: without it, any future org member mints a 24h token that bypasses every share gate (ADR-0056's accepted un-revocability trade-off would then apply to non-owners).
5. **Folders stay org-scoped.** No `owner_id` on folders; `loadOwnedFolder` and all folder operations keep the org check. Content privacy is enforced per-report at the viewer; a shared org folder tree is exactly what company orgs (ADR-0061) want. Accepted consequence: any org member may rename/delete (empty) folders, and an owner may move their report into any org folder.
6. **The wire resource exposes `owner`** (a `user_…` External Id, ADR-0052) so the dashboard can distinguish "yours" from "org".

## Consequences

- **Good:** the target privacy model holds in company orgs; behavior-neutral today (org check ≡ owner check while every org has one member); ADR-0060/0061 build on a stable seam.
- **Trade-offs:** every use-case actor widens from `{orgId}` to `{orgId, userId}` (all three front doors already resolve a `UserId` — session, API key via `acting_user_id`, reads — so no auth-seam change); error-text changes ripple through unit/e2e assertions; pglite fixtures inserting report rows must supply `owner_id`.
- **Flagged (ADR-0054 interaction / ADR-0061 prerequisite):** a soft-deleted or departed user's reports become writable by nobody (admins can't either, by decision). An **ownership-transfer / reassign story is a prerequisite for multi-member orgs** — owned by ADR-0061's implementation phase.

## More information

Migration `0010`: add nullable column → backfill from v1 uploader → `SET NOT NULL` → index. No enum involved, so the drizzle-kit one-transaction batching gotcha (#127) does not apply — but do not couple it with a future enum-adding migration in the same deploy. Implementation seam: split `load-owned.ts` into `loadOrgReport` (reads) and `loadOwnedReport` (owner check for writes). Glossary: **Owner** is sharpened to the creating user.
