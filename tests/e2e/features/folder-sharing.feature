@phase-2 @smoke @auth
Feature: Manage folder visibility and sharing from the content-header panel (ADR-0087)
  As a folder's owner
  I want to change who can see it — and repair a legacy folder — from the content header
  So that fixing an over-shared folder is self-service, in context, next to its reports

  # ADR-0087 relocated folder management out of the in-body sidebar tree (removed
  # here, T4a #334) into the CONTENT-HEADER panel over the selected folder's
  # report list; the `_app` shell rail is now the sole folder-navigation surface.
  # Management reads (the roster, the counted cascade, the bulk-apply context)
  # are loaded lazily on "Manage ▾" over GET /shares?include=manage — the panel's
  # own useFetcher.load(); writes still post through the dashboard's own
  # cookie-authenticated action. This scenario drives both doors end to end and
  # observes folder VISIBILITY on the shell rail, the content-header BADGE on the
  # dashboard SSR, and the roster/cascade on the manage payload.
  #
  # Both identities are RUN-SCOPED (fresh `<prefix>-<runId>+clerk_test@…` users,
  # same team domain → one shared anchored org), following the pattern in
  # tests/e2e/smoke/team-org-upload.steps.ts.
  #
  # NOT covered here, and deliberately: LEGACY-folder adoption (owner_id IS NULL,
  # only the pre-ADR-0076 backfill produces one — no product path mints it), and
  # the client-only fetcher INTERACTION (the "Manage ▾" disclosure, the
  # form-remount / autocomplete=off restoration guard), which the panel's
  # node-render smoke test pins (ADR-0079).
  @run-scoped
  Scenario: An owner shares, un-shares and cascades a folder from the content-header panel
    Given a folder-sharing owner identity is signed in
    And a folder-sharing colleague identity is signed in

    # Private by default (ADR-0076 §3). The count-less content-header badge reads
    # "Limited" — a private row whose roster the header did not load may not claim
    # a bare "Private" (a folder shared with five people would read the same).
    When the owner creates a run-scoped parent folder
    Then the owner's content header badges the parent folder "Limited"
    And the owner's content header names the parent folder in full
    And the owner's content header offers no management for the Root folder
    And the colleague's rail does not show the parent folder

    # The org toggle — the incident's actual repair, in reverse.
    When the owner creates a run-scoped child folder inside the parent folder
    Then the owner's manage payload names the cascade direction and the count
    When the owner shares the parent folder with the whole org
    Then the owner's content header badges the parent folder "Org"
    And the owner's org-shared manage payload does not claim only they can see the folder
    And the colleague's rail shows the parent folder
    And the colleague's manage read for the parent folder is refused

    # THE NESTED-FOLDER GAP: ADR-0076's repair is per-folder, so a descendant
    # that is already org-visible stays org-visible when the parent goes private —
    # and grafts under Root in the colleague's rail, name and all.
    When the owner shares the child folder with the whole org
    And the owner makes the parent folder private WITHOUT the cascade
    Then the colleague's rail no longer shows the parent folder
    But the colleague's rail still shows the child folder

    # …which the explicit opt-in closes, by looping the same use case.
    When the owner makes the parent folder private WITH the cascade
    Then the colleague's rail shows neither the parent nor the child folder

    # Person shares: add by email, see the roster, revoke.
    When the owner shares the parent folder with the colleague's email
    Then the owner's manage payload lists the colleague's email
    And the owner's manage payload badges the parent folder "Shared with 1"
    And the colleague's rail shows the parent folder
    When the owner removes the colleague's share
    Then the owner's manage payload roster is empty
    And the colleague's rail does not show the parent folder
