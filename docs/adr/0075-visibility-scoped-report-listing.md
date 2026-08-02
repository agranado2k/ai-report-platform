# ADR-0075: Visibility-scoped report listing — the list shows only what the viewer may see

- **Status**: Accepted
- **Date**: 2026-08-01
- **Deciders**: agranado2k
- **Relates to / amends**: ADR-0059 (per-user ownership — **amends** its §3 "reads stay org-visible (metadata)" decision for lists/search), ADR-0060 (write grants — the grant carve-out now reaches lists, not just the single-report GET), ADR-0056 (ACL modes — `org`/`public` gain a listing meaning), ADR-0053 (cursor pagination, unchanged), ADR-0036 (Reports & Folders).

## Context and problem statement

ADR-0059 §3 kept lists/search purely org-scoped: every org member saw every org report's metadata (title, slug, folder), with content access decided per-report by the `Acl` at view time. With team orgs live (ADR-0068/0074), that means a colleague's dashboard lists reports that are private to their owner — reports the colleague cannot open (`/open` owner-gates the token mint), producing both a metadata leak (titles can be sensitive; existence itself can be) and a broken-feeling UX (rows that bounce). The operator decided the product model is sharper: **the list shows a user only what they can meaningfully reach.**

## Decision drivers

- **Existence is private.** A private report's title/slug/folder — even the fact it exists — belongs to its owner. Metadata is not neutral.
- The dashboard must not render rows the viewer cannot open (the `/open` bounce).
- One predicate, enforced in the repository query — not post-filtering in the UI (which would leak through the API anyway) and not a second listing surface that forgets the rule.
- Keep keyset pagination + search semantics (ADR-0053) intact; no wire-shape change.
- Grant semantics must match `hasWriteGrant` exactly (userId OR normalized email, ADR-0060 §2) so a list never disagrees with what the user can actually write.

## Considered options

- **Visibility predicate in `searchByOrg`** *(chosen)* — owned OR broadly-shared (`org`/`public`) OR write-granted.
- Keep org-visible metadata (ADR-0059 §3 as written) — rejected: leaks existence/titles inside team orgs, and lists rows the viewer can't open.
- List all modes but badge inaccessible rows — rejected: still the metadata leak, plus UI complexity.
- Include `allowlist` rows for allowlisted viewers — rejected for now: the allowlist grants *viewer* access via magic link, addressed by email, not by app identity; joining it into the list predicate couples the dashboard to viewer-access machinery for marginal value. Revisit if users ask "where is the report I was allowlisted on?".

## Decision outcome

1. **The visibility predicate.** `ReportRepository.searchByOrg(orgId, viewer, q)` lists a non-deleted org report iff:
   - `reports.owner_id = viewer.userId` (owners always see all their own — back-compat: an owner's dashboard is unchanged), OR
   - `COALESCE(acls.mode, 'private') IN ('org', 'public')` (no acls row = private-by-default, ADR-0056), OR
   - a write grant matches the viewer (`grantee_user_id = viewer.userId` OR `grantee_email = viewer's normalized email` — the same dual match as `hasWriteGrant`, ADR-0060 §2).
2. **`public` is deliberately listed.** A `public` report is maximally shared — anyone with the link can open it — so listing it to colleagues is consistent, not a leak. `org` is the mode built for exactly this surface. `password` and `allowlist` are deliberately NOT listed to non-owners: they gate access by secret/email at the viewer, and their existence is the owner's business.
3. **The grant carve-out reaches lists.** A write-granted user sees the report in the org-scoped list they can already reach. This partially addresses what #226 tracks — but #226 **stays open** for the cross-org dashboard section: a cross-org grantee's dashboard queries *their* org, so a grant on a report in another org still doesn't surface anywhere; that needs a dedicated "shared with me" query, out of scope here.
4. **The viewer rides the use case.** `searchReports`'s actor gains `userId`; the use case resolves the actor's mirrored email once via the identities port (the `hasWriteGrant` seam) and hands `{userId, email}` to the repository. Both front doors (dashboard loader, `GET /api/v1/reports`) already resolve a `UserId`; MCP flows through the API. No wire-shape change (same list envelope).
5. **`listByOrg` (reports) is removed.** It had no production caller except `deleteFolder`'s emptiness guard, and an unscoped listing surface left in the port is a leak waiting for a caller. The guard moves to a purpose-built `hasReportsInFolder(orgId, folderId)` — deliberately NOT visibility-scoped: a report the deleter cannot see must still block the folder delete, and a bare boolean surfaces no metadata.

## Consequences

- **Good:** the target privacy model now holds on the listing surface, not just the content surface; the contract suite (both runners) carries the executable visibility matrix; owners are unaffected.
- **Trade-offs:** the listing query joins `acls` and probes `report_write_grants` (1:1 join + indexed EXISTS — cheap at current scale); the #228 e2e assertion "a colleague sees my default-private upload" inverts by design (reworked to prove the sharper claim: org-shared listed, private absent).
- **Known rough edge (not fixed here):** a listed view-only row (org/public, non-writer) links to `/reports/{slug}/open`, which owner-gates and bounces the non-owner home. UX follow-up: route non-owners to the viewer URL instead.
- **Flagged:** the ADR-0059 §3 sentence "org admins see list metadata" no longer holds for private modes — admins are ordinary viewers on this surface (consistent with ADR-0059's owner-only literalism).

## More information

Implementation: predicate in `DrizzleReportRepository.searchByOrg` (LEFT JOIN `acls` — 1:1, no fan-out — + EXISTS subquery on `report_write_grants`), mirrored by `InMemoryReportRepository` (shared `WriteGrantStore` instance); matrix tests in `report-repository.contract.ts` run against both (ADR-0046). Folder listing is unaffected (folders stay org-scoped, ADR-0059 §5; the dashboard renders no per-folder report counts, so nothing leaks there).
