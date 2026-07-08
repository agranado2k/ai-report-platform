@phase-2
Feature: Edit a report in the dashboard
  As a report owner
  I want to open my report in an in-dashboard WYSIWYG editor and save changes
  So that I don't have to re-upload a whole new HTML file for a small edit (ADR-0062)

  Background:
    Given a user signed in to the dashboard on the app origin
    And a report at slug "abc1234567" owned by that user, with live version 1

  Scenario: Opening the editor loads the report's current content
    When I open "/reports/abc1234567/edit"
    Then the editor loads with the report's editable body content
    And the presentation shell (head/style) is not shown to the editor

  Scenario: Saving an edit creates a new ReportVersion with origin "editor"
    When I edit the report body and click "Save"
    Then a new ReportVersion is created with "origin" of "editor"
    And the new version starts with "scan_status" of "pending"
    And the saved HTML still carries the report's presentation shell unchanged

  Scenario: The saved sidecar never becomes a publicly servable file
    Given I have saved an edit
    Then the new version's manifest does not list "_source.json"
    And requesting "view.<domain>/abc1234567/_source.json" is not found

  Scenario: A saved edit shows up in the report's version history as "editor"
    Given I have saved an edit
    When I GET "/api/v1/reports/abc1234567/versions"
    Then the newest version's "origin" is "editor"

  Scenario: An unauthenticated request to save an edit is rejected
    When an unauthenticated request POSTs a save to "/reports/abc1234567/edit"
    Then the response status is 401

  Scenario: A non-owner cannot open or save the editor for someone else's report
    Given a report at slug "xyz9876543" owned by a different user
    When that different user's session opens "/reports/xyz9876543/edit"
    Then they are redirected away, never seeing the report's content
