@phase-4 @wip
Feature: Detect API-key usage anomalies
  As the platform operator
  I want suspicious API-key usage flagged
  So that I am alerted to possible key compromise (ADR-0016)

  # WIP: anomaly detection lands in Phase 4; it alerts, it does not block in v1.
  Scenario Outline: An anomaly raises an alert
    Given a baseline of normal usage for an API key
    When a "<signal>" anomaly occurs
    Then an "ApiKeyAnomalyDetected" event raises an admin alert
    And the request is not blocked synchronously

    Examples:
      | signal              |
      | geo shift           |
      | rate spike          |
      | repeated auth fail  |
