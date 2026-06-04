@phase-1
Feature: Re-upload keeps the slug stable
  As a report owner
  I want re-uploading to update the content behind the same URL
  So that the link I shared never breaks (the core value proposition)

  Background:
    Given a report published at slug "abc1234567" with live version 1
    And an API key with the "reports:write" scope

  Scenario: Re-upload with update_slug creates a new version at the same slug
    When I POST new content to "/api/v1/reports" with "update_slug" of "abc1234567"
    Then the response status is 201
    And the returned "slug" is still "abc1234567"
    And a new ReportVersion with "version" 2 is created
    And version 2 starts with "scan_status" of "pending"

  Scenario: Version 2 becomes live only after a clean scan, monotonically
    Given version 2 exists with "scan_status" of "pending"
    When "ReportVersionScanned" reports verdict "clean" for version 2
    Then the live version becomes 2
    And requesting the slug serves version 2

  Scenario: Older versions remain reachable by ordinal
    Given the live version is 2
    When I request the slug with "?v=1"
    Then version 1 is served

  Scenario: Content-only — title, folder_path, or acl on re-upload are rejected
    When I POST to "/api/v1/reports" with "update_slug" and a "folder_path" in the body
    Then the response status is 422
    And the problem+json "code" is "validation_error"
