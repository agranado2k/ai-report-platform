@phase-1 @security
Feature: Enforce API key scopes
  As the platform operator
  I want each API key restricted to its granted scopes
  So that a read key cannot perform writes (ADR-0016)

  Scenario: A write requires the reports:write scope
    Given an API key without the "reports:write" scope
    When I POST a report to "/api/v1/reports"
    Then the response status is 403
    And the problem+json "code" is "forbidden"

  Scenario: A missing or invalid key is unauthenticated, not forbidden
    Given no API key is presented
    When I POST a report to "/api/v1/reports"
    Then the response status is 401
    And the problem+json "code" is "unauthenticated"

  Scenario: A key with the right scope succeeds
    Given an API key with the "reports:write" scope
    When I POST a report to "/api/v1/reports"
    Then the response status is 201
