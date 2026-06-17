@smoke @auth
Feature: Authenticated upload API smoke
  As a signed-in user
  I want POST /api/v1/reports to honor my Clerk session
  So that my uploads are attributed to my own org, not the demo identity (ADR-0048)

  # @auth runs only when the staging Clerk creds are present (E2E_CLERK_SECRET_KEY
  # + E2E_TEST_USER_EMAIL); playwright.config.ts grep-excludes it otherwise, so a
  # local `pnpm e2e` without creds skips it. The e2e mints a real session token
  # for the seeded test user via the Clerk backend API (no browser sign-in) and
  # sends it as the __session cookie. This is ADDITIVE — the unauthenticated smoke
  # still passes via the DEMO_ACTOR fallback; the flip (anon → 401) is a later slice.
  Scenario: A real Clerk session is honored server-side and accepts an upload
    Given I am signed in as the seeded Clerk test user
    When I GET the dashboard with my session
    Then the server resolved my Clerk user id
    When I upload an HTML report file with my session to "/api/v1/reports"
    Then the authenticated upload response status is 201
    And the authenticated upload returns a slug and a canonical view_url
