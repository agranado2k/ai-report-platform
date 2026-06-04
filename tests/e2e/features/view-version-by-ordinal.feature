@phase-1
Feature: View a specific version with ?v=N
  As a link holder
  I want to open an older version by its ordinal
  So that I can see a previous snapshot of the report

  Background:
    Given a report at slug "abc1234567" with clean versions 1 and 2
    And the live version is 2

  Scenario: A clean version ordinal is served through the same gate
    When I request the slug with "?v=1"
    Then the response status is 200
    And version 1 is served through the same ACL and scan gate as the live URL

  Scenario: An unknown version ordinal is not found
    When I request the slug with "?v=99"
    Then the response status is 404

  Scenario: A pending or flagged ordinal follows the live state machine
    Given version 3 exists with "scan_status" of "pending"
    When I request the slug with "?v=3"
    Then a "scanning…" holding page is shown with status 200

  Scenario: A taken-down report is gone at any ordinal
    Given the report has been taken down
    When I request the slug with "?v=1"
    Then the response status is 410
