@phase-1
Feature: Upload a report via the HTTP API
  As an API client (often an LLM or agent)
  I want to upload an HTML report and receive a permanent URL
  So that I can share a rendered report by link

  Background:
    Given an authenticated acting user in an organization
    And an API key with the "reports:write" scope

  Scenario: Uploading a single HTML file creates a report
    When I POST a single "report.html" file to "/api/v1/reports"
    Then the response status is 201
    And the body contains a "slug", a "view_url", a "version" of 1, and "scan_status" of "pending"
    And the file is stored as the entry document "index.html"

  Scenario: Uploading a zip bundle with one wrapping directory strips it
    Given a zip bundle whose only top-level entry is a "site/" directory containing "index.html"
    When I POST the bundle to "/api/v1/reports"
    Then the response status is 201
    And the wrapping "site/" directory is stripped so the entry document is "index.html"

  Scenario: A new report is placed in the org root folder by default
    When I POST a report to "/api/v1/reports" without a "folder_path"
    Then the response status is 201
    And the report is placed in the organization's root folder

  Scenario: The new version is not served until scanned clean
    When I POST a report to "/api/v1/reports"
    Then the report has no live version yet
    And the live version is unchanged until "ReportVersionScanned" reports the verdict "clean"
