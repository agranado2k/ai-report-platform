@smoke
Feature: Dashboard auth gate
  As the platform operator
  I want every dashboard page except /sign-in, /sign-up and /health to require a session
  So that unauthenticated visitors can't reach protected pages (ADR-0048)

  # No Clerk creds needed: these assert the gate's UNAUTHENTICATED behaviour, which
  # any preview can exercise. The authenticated side (a real session reaches the
  # dashboard) is covered by the @auth scenario.
  # The first two Thens describe the MIDDLE of the journey (a status, a Location
  # header); the third describes where the visitor actually ends up. Asserting
  # only an intermediate hop is the exact habit that let two production incidents
  # ship (#188, ADR-0080) — see tests/e2e/support/follow.ts.
  Scenario: An unauthenticated protected page redirects to sign-in
    When I request "/upload" without following redirects
    Then the gate status is 302
    And the gate redirects to "/sign-in"
    And the chain ends at the sign-in page still carrying "/upload" as the destination

  Scenario: The sign-in page itself is public
    When I request "/sign-in" without following redirects
    Then the gate status is 200

  Scenario: A Clerk sub-path under the allowlist is public (prefix match)
    When I request "/sign-in/sso-callback" without following redirects
    Then the gate status is 200
