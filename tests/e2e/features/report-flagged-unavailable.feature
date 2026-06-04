@phase-1.5 @wip
Feature: Flagged report is unavailable (451)
  As the platform operator
  I want a flagged version to stop serving without revealing why
  So that abuse handling stays reason-opaque (ADR-0038)

  # WIP: scanning + abuse pipeline lands in Phase 1.5.
  Scenario: A flagged version returns 451
    Given a report whose relevant version is flagged
    When I request the report
    Then the response status is 451
    And no moderation reason is disclosed
