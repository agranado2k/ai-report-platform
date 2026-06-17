@smoke
Feature: Upload report API auth gate
  As the platform operator
  I want POST /api/v1/reports to require a signed-in session
  So that anonymous writes are rejected (ADR-0048)

  # The flip dropped DEMO_ACTOR — an unauthenticated write is now 401. The
  # authenticated 201 path (mint a real Clerk session → upload) is covered by the
  # @auth scenario in auth-upload.feature.
  Scenario: Unauthenticated upload is rejected with 401
    When I upload an HTML report file to "/api/v1/reports"
    Then the upload response status is 401
    And the upload error code is "unauthenticated"
