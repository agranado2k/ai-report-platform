@phase-1 @security
Feature: Block service-worker registration
  As the platform operator
  I want service-worker scripts blocked at the edge
  So that hosted content cannot persist a background interceptor (ADR-0014)

  Scenario: A request for a service-worker script is refused
    Given a report bundle that includes a service worker script
    When a viewer requests it with a "Service-Worker: script" header
    Then the response status is 403

  Scenario: Normal report assets are unaffected
    When a viewer requests an ordinary asset from the report
    Then the asset is served normally with status 200
