@phase-1
Feature: Audit-log every mutating action
  As the platform operator
  I want every mutating action recorded
  So that there is a tamper-evident trail for security and abuse review

  Scenario: An upload writes an audit row
    Given an API key with the "reports:write" scope
    When I upload a report
    Then an audit row records the actor, action, target, and timestamp

  Scenario: A denied action is still recorded
    Given an API key without the "reports:write" scope
    When I attempt an upload and receive 403
    Then an audit row records the denied attempt

  Scenario: Audit rows redact secrets
    When any action is logged
    Then API keys and other secrets are redacted in the audit record
