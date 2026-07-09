@smoke @auth @browser
Feature: Authenticated editor smoke (real browser)
  As a signed-in report owner
  I want the dashboard report editor to open and render for me
  So that an authenticated regression (#171 unstyled, #172 SSR 500) is caught in CI

  # Both #171 and #172 broke ONLY behind auth: an unauthenticated GET to
  # /reports/:slug/edit redirects to /sign-in BEFORE ReportEditor ever renders
  # (see app-route-boot.feature, which proves the route's module graph boots —
  # but deliberately stays auth-agnostic and never reaches the component). No
  # existing e2e opened this route as a signed-in user in a real browser — the
  # other @auth scenario (auth-upload.feature) is `request`-only (API + Bearer
  # JWT), which can't observe client-side rendering or hydration at all. This
  # scenario runs under the `chromium-auth` Playwright project, whose `page`
  # fixture is pre-authenticated via storageState (tests/e2e/support/clerk-auth.setup.ts) —
  # a real Clerk browser session for the SAME seeded test user auth-upload.feature
  # uses, established via a Clerk sign-in ticket (@clerk/testing), not a Bearer header.
  #
  # Gated like @auth, plus one more requirement: @browser additionally needs
  # E2E_CLERK_PUBLISHABLE_KEY (the sign-in ticket exchange happens client-side,
  # via @clerk/clerk-js, which needs the publishable key to initialize). Absent
  # any of the three, playwright.config.ts grep-excludes @browser entirely — it
  # never runs half-configured (see the `chromium` project's grepInvert there).
  Background:
    Given a report I own exists

  Scenario: The editor opens for its owner, boots, and renders the report's own styling
    When I open the editor for that report
    Then I am not redirected to sign-in
    And the editor surface is present
    And the editor renders the report styled
