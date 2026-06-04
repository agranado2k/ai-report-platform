@phase-1 @wip @security
Feature: Trusted Types on the dashboard
  As the platform operator
  I want the dashboard to enforce Trusted Types
  So that stray innerHTML sinks cannot introduce DOM XSS (ADR-0011)

  # WIP: dashboard hardening is asserted once the dashboard UI exists.
  Scenario: An unsafe innerHTML assignment is blocked
    Given the dashboard with a Trusted Types policy enforced
    When code assigns an untrusted string to innerHTML
    Then the assignment throws and no markup is injected
