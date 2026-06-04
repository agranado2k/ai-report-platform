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
