@phase-2 @smoke @auth
Feature: Manage folder visibility and sharing from the dashboard (ADR-0076 §6)
  As a folder's owner
  I want to change who can see it — and repair a legacy folder — from the sidebar
  So that fixing an over-shared folder is self-service, not an MCP call

  # This is the UI half of ADR-0076. PR #230 shipped the model, the API and the
  # MCP tools; the only repair path for the incident folder ("every member sees
  # Engineering") was a hand-run MCP call, which is why it never got fixed. The
  # scenario below drives the DASHBOARD's own cookie-authenticated Remix action
  # end to end — the same door a browser click uses — and asserts on the
  # server-rendered sidebar markup.
  #
  # Both identities are RUN-SCOPED (fresh `<prefix>-<runId>+clerk_test@…` users,
  # same team domain → one shared anchored org), following the pattern in
  # tests/e2e/smoke/team-org-upload.steps.ts: a user that didn't exist before
  # this run can't carry a poisoned identity mirror from an earlier run in the
  # persistent, prod-forked preview DB branch. The @run-scoped After hook
  # best-effort deletes both users and the folders they created.
  #
  # NOT covered here, and deliberately: LEGACY-folder adoption. A legacy row is
  # `owner_id IS NULL`, which only the pre-ADR-0076 backfill produces — there is
  # no supported way to mint one through the product, so the adoption warning
  # and the owner-or-legacy gate are covered by the unit tests on
  # `folderManagement` (apps/app/app/server/folder-sharing.server.test.ts) and
  # by `load-owned.test.ts` on the server rule this UI mirrors.
  @run-scoped
  Scenario: An owner shares, un-shares and cascades a folder from the sidebar
    Given a folder-sharing owner identity is signed in
    And a folder-sharing colleague identity is signed in

    # Private by default (ADR-0076 §3) — a new folder under Root is the
    # creator's alone, and the sidebar says so.
    # The badge says only what the loader actually KNOWS. It pays for one share
    # roster (the folder in `?manage=`), so every other private row has an
    # unknown roster — and "Private" there would be a positive claim sitting one
    # row below a "Shared with 2". `Limited` is that claim at a width the 14rem
    # sidebar can afford; the full sentence is in the badge's title.
    When the owner creates a run-scoped parent folder from the dashboard sidebar
    Then the owner's sidebar badges the parent folder "Limited"
    And the owner's sidebar names the parent folder in full on hover
    And the owner's sidebar renders no sharing controls for the Root folder
    And the colleague's sidebar does not show the parent folder

    # The org toggle — the incident's actual repair, in reverse.
    When the owner creates a run-scoped child folder inside the parent folder
    Then the owner's cascade checkbox names the direction and the count
    When the owner shares the parent folder with the whole org from the sidebar
    Then the owner's sidebar badges the parent folder "Org"
    And the owner's org-shared roster does NOT claim only they can see the folder
    And the colleague's sidebar shows the parent folder
    And the colleague's sharing menu for the parent folder is refused with a reason

    # THE NESTED-FOLDER GAP: ADR-0076's repair is per-folder, so a descendant
    # that is already org-visible stays org-visible when the parent goes
    # private — and grafts under Root in the colleague's tree, name and all.
    When the owner shares the child folder with the whole org from the sidebar
    And the owner makes the parent folder private WITHOUT the cascade
    Then the colleague's sidebar no longer shows the parent folder
    But the colleague's sidebar still shows the child folder

    # …which the explicit opt-in closes, by looping the same use case.
    When the owner makes the parent folder private WITH the cascade
    Then the cascade result names the child folder as changed
    And the colleague's sidebar shows neither the parent nor the child folder

    # Person shares: add by email, see the roster, revoke.
    When the owner shares the parent folder with the colleague's email from the sidebar
    Then the owner's share roster for the parent folder lists the colleague's email
    And the owner's managed sidebar badges the parent folder "Shared with 1"
    And the colleague's sidebar shows the parent folder
    When the owner removes the colleague's share from the sidebar
    Then the owner's share roster for the parent folder is empty
    And the colleague's sidebar does not show the parent folder
