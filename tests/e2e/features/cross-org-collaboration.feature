@phase-2.5 @wip
Feature: Cross-org collaboration via grants
  As a folder admin
  I want to grant a collaborator from another org write access
  So that they can update reports under that folder (ADR-0009)

  # WIP: collaboration grants land in Phase 2.5.
  Scenario: A granted collaborator can update; a revoked one cannot
    Given Acme grants Alice editor access to a folder
    When Alice updates a report in that folder with her own API key
    Then the update succeeds
    When Acme revokes Alice's grant
    And Alice attempts the same update
    Then the response status is 403
