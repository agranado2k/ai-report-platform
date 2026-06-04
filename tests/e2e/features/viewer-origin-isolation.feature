@phase-1 @security
Feature: Viewer origin isolation
  As the platform operator
  I want hosted content fully isolated from the dashboard origin
  So that untrusted reports cannot reach the app's session or API (ADR-0002)

  Scenario: A report's fetch to the app API is blocked by CORS
    Given a report rendered on the view origin
    When the report attempts to fetch the app API on the app origin
    Then the request is blocked by the cross-origin policy

  Scenario: The viewer carries no dashboard cookies
    When I request a report on the view origin
    Then no app-session cookies are present
    And all platform cookies use the "__Host-" prefix

  Scenario: The viewer always sends noindex
    When I request any report
    Then the response carries "X-Robots-Tag: noindex"
