@phase-1.5 @wip
Feature: Enforce rate limits
  As the platform operator
  I want per-key, per-IP, and per-email rate limits
  So that abuse and runaway clients are throttled

  # WIP: full rate-limit matrix lands in Phase 1.5.
  Scenario: An over-limit client is throttled
    Given a client exceeding its request rate
    When it makes another request
    Then the response status is 429
    And the problem+json "code" is "rate_limited"
