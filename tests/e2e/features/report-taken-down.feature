@phase-1.5 @wip
Feature: Taken-down report is gone (410)
  As the platform operator
  I want a taken-down report to return Gone
  So that withdrawn content stops serving (ADR-0038)

  # WIP: abuse + takedown pipeline lands in Phase 1.5.
  Scenario: A taken-down report returns 410
    Given a report that has been taken down
    When I request the report at any version
    Then the response status is 410
    And the object-storage keys are queued for purge after the appeal window
