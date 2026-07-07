@phase-2 @wip
Feature: List a report's version history
  As a report owner or dashboard/agent client
  I want to discover a report's ReportVersion history without guessing ?v=N
  So that I can review past uploads/edits and pick versions to compare (ADR-0065)

  Background:
    Given an authenticated acting user in an organization
    And an API key with the "reports:read" scope
    And a report at slug "abc1234567" with clean versions 1 and 2

  Scenario: Listing a report's versions returns them newest-created first
    When I GET "/api/v1/reports/abc1234567/versions"
    Then the response status is 200
    And the body is a list envelope with "object" of "list"
    And the versions are ordered newest-created first
    And each version has "version_no", "id", "uploaded_by", "uploaded_at", "scan_status", "size_bytes", and "origin"
    And every version's "origin" is "upload"

  Scenario: The version list is cursor-paginated like the report list
    Given the report at slug "abc1234567" has 5 versions
    When I GET "/api/v1/reports/abc1234567/versions?limit=2"
    Then the response status is 200
    And the body contains 2 items and "has_more" of true
    When I GET "/api/v1/reports/abc1234567/versions" with "starting_after" set to the last item's id
    Then the response contains the next page, with no overlap with the first page

  Scenario: A report outside the caller's org is not-allowed
    Given a report at slug "xyz9876543" owned by a different organization
    When I GET "/api/v1/reports/xyz9876543/versions"
    Then the response status is 403

  Scenario: An unauthenticated request is rejected
    When I GET "/api/v1/reports/abc1234567/versions" with no credential
    Then the response status is 401
