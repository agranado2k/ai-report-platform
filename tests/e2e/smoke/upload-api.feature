@smoke
Feature: Upload report API smoke
  As the platform operator
  I want POST /api/v1/reports to accept a file and return a canonical view URL
  So that the CI → preview → API → DB/R2 path is proven end-to-end (ADR-0019)

  # The viewer now lives on the PSL-isolated view origin (ADR-002 / ADR-0038):
  # view_url = view.<domain>/<slug>. On previews VIEW_ORIGIN is unset, so the API
  # falls back to the request origin and the app no longer serves the report
  # itself — the cross-origin functional serve is post-merge prod verification
  # (the ADR-0038 gate behaviour is covered by resolveViewableReport unit tests).
  Scenario: Upload returns 201 pending with a canonical view URL
    When I upload an HTML report file to "/api/v1/reports"
    Then the upload response status is 201
    And the upload body has a "slug", a canonical "view_url", a "version" of 1, and "scan_status" of "pending"
