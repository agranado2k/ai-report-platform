@phase-2 @wip
Feature: Creator-owned folder visibility and sharing (ADR-0076)
  As a folder creator
  I want my folders to be visible only to me unless I share them
  So that my workspace structure stays private inside a team org

  # WIP as a step-defined suite for the same reason as report-write-grants.feature
  # (features/** isn't collected by playwright.config.ts yet). The LIVE
  # end-to-end coverage for this feature is the team-org smoke
  # (tests/e2e/smoke/team-org-upload.feature — "A private folder stays
  # invisible to colleagues until shared to the org"), plus:
  #   - folder-repository.contract.test.ts on BOTH runners (the ADR-0076
  #     visibility matrix: owner / legacy / org / share-by-user /
  #     share-by-email / private-invisible / root-always-visible)
  #   - folder-share-store.contract.test.ts on BOTH runners
  #   - create-folder / rename-folder / delete-folder / move-report /
  #     list-folders / set-folder-visibility / share-folder / unshare-folder
  #     use-case tests, load-owned.test.ts guard tests, and the
  #     graftOrphansToRoot unit tests (arp-domain)

  Background:
    Given a team org with members Alice and Bob

  Scenario: A new folder is private to its creator
    When Alice creates a folder "Research" under the Root
    Then Alice sees "Research" in her folder tree
    And Bob does not see "Research" anywhere

  Scenario: Sharing a folder to the whole org reveals it
    Given Alice's private folder "Research"
    When Alice sets its visibility to "org"
    Then Bob sees "Research" in his folder tree

  Scenario: Sharing a folder with one person grants visibility only
    Given Alice's private folder "Research"
    When Alice shares "Research" with Bob by email
    Then Bob sees "Research" in his folder tree
    But Bob cannot rename, delete, or create folders inside "Research"

  Scenario: A visible report in an invisible folder groups under Root
    Given Alice's private folder "Research" containing an org-shared report
    Then Bob sees the report grouped under Root
    And Bob still does not see the folder "Research"

  Scenario: Legacy folders stay org-visible until adopted
    Given a folder created before per-user folder ownership
    Then every member sees it
    When Alice sets its visibility to "private"
    Then Alice becomes its owner and only Alice sees it
