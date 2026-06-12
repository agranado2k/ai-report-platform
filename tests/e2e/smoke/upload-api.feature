@smoke
Feature: Upload report API smoke
  As the platform operator
  I want POST /api/v1/reports to accept a file and return a working view URL
  So that the CI → preview → API → DB/R2 → viewer path is proven end-to-end (ADR-0019)

  Scenario: Upload returns 201 pending; the viewer holds until the async scan promotes it
    When I upload an HTML report file to "/api/v1/reports"
    Then the upload response status is 201
    And the upload body has a "slug", a "view_url", a "version" of 1, and "scan_status" of "pending"
    And the "view_url" shows the scanning holding page
    And after the scan drain runs, the "view_url" serves the uploaded report
