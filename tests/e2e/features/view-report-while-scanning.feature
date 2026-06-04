@phase-1
Feature: View a report that is still scanning
  As a link holder who opens a freshly uploaded report
  I want a clear holding page instead of an error
  So that I know to check back shortly

  Scenario: A report whose newest version is pending shows a holding page
    Given a report at slug "abc1234567" with no live version yet
    And the newest version has "scan_status" of "pending"
    When I request the report
    Then the response status is 200
    And a "scanning… check back" holding page is shown
    And the page auto-refreshes
    And the response carries "X-Robots-Tag: noindex"

  Scenario: Once the scan is clean the live version replaces the holding page
    Given the holding page is showing for a pending report
    When "ReportVersionScanned" reports verdict "clean"
    Then a later request serves the report content with status 200
