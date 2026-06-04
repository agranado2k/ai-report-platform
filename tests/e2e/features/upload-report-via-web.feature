@phase-1
Feature: Upload a report from the web UI
  As a signed-in user
  I want to upload a report from the dashboard
  So that I can publish without using the API directly

  Background:
    Given a user signed in to the dashboard on the app origin

  Scenario: Uploading a single HTML file from the web
    When I choose a single "report.html" file and submit the upload form
    Then the report is created and I see its permanent view URL
    And the entry document is normalized to "index.html"

  Scenario: Uploading a zip bundle from the web
    When I choose a "report.zip" bundle and submit the upload form
    Then the report is created and I see its permanent view URL
    And the dashboard shows the report as "scanning"

  Scenario: The dashboard surfaces that public reports are link-shareable
    When I upload a report
    Then the dashboard clearly states the report is shared with "anyone with the link"
