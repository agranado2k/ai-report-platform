@phase-1
Feature: View a published report
  As anyone holding a report's capability URL
  I want the live version to render
  So that I can read the report

  Background:
    Given a report at slug "abc1234567" whose live version is clean
    And the report's ACL mode is "public"

  Scenario: A clean live version is served
    When I request "view.<domain>/abc1234567"
    Then the response status is 200
    And the entry document is streamed from object storage
    And the response carries "X-Robots-Tag: noindex"

  Scenario: The full security-header stack is applied
    When I request the report
    Then the response includes the ADR-0013 security-header stack
    And an abuse-report link is injected into the page

  Scenario: The capability URL is unguessable, not discoverable
    Then the slug is a nanoid(10) capability with roughly 10^18 of entropy
    And the report is not indexable by crawlers
