@smoke @auth
Feature: Team-org JIT join-or-create smoke (ADR-0068, ADR-0074)
  As the second identity at a corporate email domain
  I want my first authenticated request to join (or create) my domain's team org
  So that domain-keyed single-org membership actually provisions in production, not just in unit tests

  # Runs under the same @auth gate as auth-upload.feature (needs
  # E2E_CLERK_SECRET_KEY; see playwright.config.ts). Uses the ADR-0068 §6 second
  # fixture (silver+clerk_test@agranado.com — tests/e2e/README.md), whose domain
  # is deliberately NOT on the public-provider list, so this exercises the
  # `team`-org branch of provisionIdentity. The upload exercises the write
  # path's JIT provisioning; the read path lazily provisions too since the
  # ADR-0048 amendment (2026-08-01), covered by the third identity below.
  Scenario: The second identity's first authenticated upload provisions its team org
    Given I am signed in as the second (team-org) Clerk test user
    When I upload an HTML report file with my second session to "/api/v1/reports"
    Then the second session's upload response status is 201
    And the second session's upload returns a slug and a canonical view_url

  # ADR-0074 — the assertion the old smoke deliberately dodged ("either outcome
  # is a pass" is what let the dead slug-keyed lookup ship): two identities at
  # the SAME corporate domain must resolve to ONE shared org. Both identities
  # are RUN-SCOPED (fresh `<prefix>-<runId>+clerk_test@agranado.com` users,
  # created programmatically — see tests/e2e/README.md): the PR #222 round-3
  # lesson is that a REUSED fixture can carry a poisoned mirror from an earlier
  # run in the persistent, prod-forked preview DB branch, which the
  # sticky-after-mirror policy then CORRECTLY honors — masking the canonical
  # chain this scenario exists to prove. Each identity also carries a
  # self-created anchorless DECOY org, replicating the duplicate that
  # force_organization_selection produces in prod (and, on the dev instance,
  # the only way a fresh user's backend-minted session comes out `active`
  # instead of `pending`/401 — Clerk auto-activates the sole membership, so the
  # session actively CARRIES the decoy). Both uploads must land in the
  # CANONICAL anchored domain org despite the decoys; the final listing is read
  # with a session re-minted with that canonical org ACTIVE — like a browser
  # session after the forced task's org selection. Fixtures are best-effort
  # deleted after the scenario (@run-scoped cleanup hook).
  # The THIRD identity is the ADR-0048 amendment's proof (provision-on-read,
  # 2026-08-01): it NEVER uploads — its first authenticated request is the
  # bare session GET /api/v1/reports. Pre-amendment that read resolved to a
  # null actor (unmirrored → 401/empty); now the read door lazily provisions
  # through the same canonical chain (its session actively carries its DECOY
  # org, which the mirror-miss branch must ignore).
  # VISIBILITY (ADR-0075, amends the original #228 assertion BY DESIGN): the
  # two uploads are default-PRIVATE, so a colleague no longer sees them just
  # by sharing the org. The first identity org-shares ITS report via the ACL
  # API; the third (never-written, owns nothing) must then list EXACTLY the
  # org-shared report and NOT the second identity's still-private one — the
  # sharper form of the same shared-org proof: the org-shared report could
  # only appear if all three identities resolved to ONE org row, and the
  # private one's absence proves existence stays private inside that org.
  # The second identity still lists both: its own by ownership, the first's
  # by the org share.
  # FOLDER VISIBILITY (ADR-0076, extends the same fixture set): the first
  # identity creates a folder under Root — private by default, owned by its
  # creator — and moves its ORG-SHARED report into it. The third identity must
  # then still LIST the report (org-shared, ADR-0075) while its containing
  # folder stays absent from the folder list (folder existence is private,
  # ADR-0076) — the report's folder_id dangles by design; the dashboard groups
  # such reports under Root. Setting the folder's visibility to `org` (the
  # owner's call, acl:write rides the session) must then surface the folder in
  # the third identity's tree. Folded into this scenario (not a sibling) so it
  # reuses the run-scoped fixtures the @run-scoped cleanup hook deletes.
  # REPORT SHARING REACHES THE FOLDER'S CONTENTS (ADR-0078 — the bug this was
  # written for). Sharing a folder with the org shows the FOLDER; the reports
  # inside stay governed by their own Acls (ADR-0076 §6, deliberately). So a
  # colleague sees an empty-looking shared folder. The last four steps prove the
  # repair END TO END against real infra: the first identity puts a PRIVATE
  # report into the now-org-shared folder (the move must NOT publish it —
  # ADR-0078 §7, since move is canWrite-gated and a cross-org grantee must never
  # be able to publish what they cannot read); the third identity cannot see it,
  # which IS the reported bug; the owner then applies `org_edit` to the folder's
  # reports; and the third identity must then LIST it, be able to OPEN it
  # (single-report GET), and be able to EDIT it (PATCH rename — the canWrite
  # seam's new org-write leg, exercised through the real HTTP door).
  # THE ESCALATION IS A CHANGE, NOT A SKIP. The same apply also covers the
  # report that was already `org_view`: `org_view` and `org_edit` share an Acl
  # mode and differ only in the org-write row, so a candidate rule reading the
  # mode alone skipped that report as "already shared with your org" — 200,
  # nothing granted, reported as success. It must now be CHANGED, and the proof
  # is that the third identity can subsequently RENAME it and reads its
  # composed `sharing` back as `org_edit` (ADR-0078 §13) — neither of which is
  # true of a report the apply merely claimed to have handled.
  # THE HONEST SKIP is then proved where it is real: applying `org_edit` a
  # SECOND time must change nothing and name both reports back with the domain's
  # own reason, which says WHICH org state they are already in.
  @run-scoped
  Scenario: Two same-domain identities share one team org
    Given a first run-scoped team-domain identity is signed in
    And a second run-scoped team-domain identity is signed in
    And a third run-scoped team-domain identity is signed in and never uploads
    When the first run-scoped identity uploads an HTML report file to "/api/v1/reports"
    And the second run-scoped identity uploads its own HTML report file to "/api/v1/reports"
    And the first run-scoped identity shares its report org-wide via the ACL API
    Then the second run-scoped identity's report listing includes both run-scoped uploads
    And the third run-scoped identity's first-ever session read lists exactly the org-shared upload
    When the first run-scoped identity creates a private folder and moves its org-shared report into it
    Then the third run-scoped identity lists the org-shared report but NOT the private folder
    When the first run-scoped identity sets the folder's visibility to org
    Then the third run-scoped identity's folder list now includes the run-scoped folder
    When the first run-scoped identity puts a private report inside the shared folder
    Then the third run-scoped identity cannot see the private report inside the shared folder
    When the first run-scoped identity shares the folder's reports for viewing and editing
    Then the third run-scoped identity can list, open and edit the once-private report
    And the third run-scoped identity can edit the escalated report, whose sharing reads org_edit
    When the first run-scoped identity applies the same sharing to the folder's reports again
    Then every report in the folder is skipped as already shared with your org to view and edit
