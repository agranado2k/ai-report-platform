@phase-2 @wip
Feature: Viewer's /<slug>/edit deep-links to the dashboard editor
  As a report owner viewing a report on view.<domain>
  I want a one-click path from the public viewer to editing that report
  So that I don't have to navigate to the dashboard and search for it (ADR-0063 Decision 3)

  Background:
    Given a report at slug "abc1234567" with clean version 1

  Scenario: Visiting the deep-link redirects to the dashboard's edit route
    When I GET "https://view.centaurspec.com/abc1234567/edit"
    Then the response status is 302
    And the "Location" header is "https://app.centaurspec.com/reports/abc1234567/edit"
    And the response carries no first-party JS and no HTML body

  Scenario: The redirect requires no credential — auth happens after the hop
    When I GET "https://view.centaurspec.com/abc1234567/edit" with no credential
    Then the response status is 302
    And the redirect target is the SAME regardless of the caller's identity

  Scenario: An unknown or malformed slug is rejected before a redirect is built
    When I GET "https://view.centaurspec.com/not a valid slug/edit"
    Then the response status is 404

  Scenario: The public viewer route is untouched by this deep-link
    When I GET "https://view.centaurspec.com/abc1234567"
    Then the response status is 200
    And the security headers are byte-for-byte the same as before this feature shipped
