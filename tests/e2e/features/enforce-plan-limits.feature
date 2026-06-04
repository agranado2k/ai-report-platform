@phase-1
Feature: Enforce plan limits on upload
  As the platform operator
  I want plan quotas enforced at upload
  So that a free-tier organization cannot exceed its allowance (ADR-0006)

  Background:
    Given an organization on the free plan
    And an API key with the "reports:write" scope

  Scenario: Exceeding the free-tier report cap is rejected cleanly
    Given the organization is at its free-plan report cap
    When I POST a new report to "/api/v1/reports"
    Then the response status is 402
    And the problem+json "code" is "plan_limit_exceeded"

  Scenario: A plan limit is distinct from rate limiting
    When the organization is over a hard quota
    Then the response is 402 and not 429
    And waiting does not clear the condition
