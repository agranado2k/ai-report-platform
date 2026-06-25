@smoke
Feature: Platform health endpoint
  As the platform operator
  I want a health endpoint that confirms the app is serving
  So that the e2e harness has a always-true scenario to prove the CI → preview → browser path

  Scenario: The app health endpoint reports ok
    When I GET "/health" on the app
    Then the response status is 200
    And the JSON field "status" is "ok"
    And the JSON field "service" is "app"
    And the JSON field "version" is present
    And the JSON field "commit" is present

  # Regression guard for the #100 → prod-down incident (#103): /health does NOT import
  # the composition root, so a runtime module-load crash (e.g. an un-traced native dep
  # like @node-rs/argon2) passed CI green while every real route 500'd. This hits an
  # API route that DOES import container.server — a 401 proves the serverless function
  # boots and all imports resolve; a module-load crash would 500 (and not parse as JSON).
  Scenario: The API surface boots without a runtime module-load crash
    When I GET "/api/v1/reports" on the app
    Then the response status is 401
    And the JSON field "code" is "unauthenticated"
