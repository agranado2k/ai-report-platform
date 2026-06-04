@phase-1.5 @wip
Feature: Submit an abuse report
  As any viewer
  I want to report a hosted report as abusive
  So that the operator can review and act (ADR-0012)

  # WIP: abuse intake lands in Phase 1.5.
  Scenario: A viewer submits an abuse report
    Given a hosted report
    When a viewer submits an abuse complaint with a category
    Then an "AbuseReported" event is recorded with a status and audit trail
