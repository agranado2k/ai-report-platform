@phase-1 @security
Feature: Viewer security-header stack
  As the platform operator
  I want every viewer response to carry the full security-header stack
  So that untrusted content is sandboxed in the browser (ADR-0013)

  Scenario: The required headers are present on a served report
    When I request a clean report on the view origin
    Then the response includes the complete ADR-0013 security-header stack
    And the response includes a Content-Security-Policy
    And the response carries "X-Robots-Tag: noindex"

  Scenario: CSP violations are reported
    Given a report whose content violates the Content-Security-Policy
    When the browser reports the violation to "/csp-report"
    Then a "CspViolationReported" event is recorded for policy drift detection
