@smoke @auth @browser
Feature: Authenticated owner-open hand-off smoke (real browser)
  As a signed-in report owner
  I want opening my own report to authenticate me and hand me off toward the
  unified in-viewer editor
  So that a regression in the app-side half of that hand-off is caught in CI

  # RETRIMMED (issue #173 follow-up, ADR-0063 Phase 5 dashboard-editor
  # retirement): this scenario used to drive the DASHBOARD's own
  # /reports/:slug/edit page end-to-end in a real browser (open it, assert the
  # ProseMirror surface mounted, assert the report's own CSS reached the
  # sandboxed iframe — the #171/#172 regression class). That page is deleted;
  # the unified in-viewer editor now lives entirely on view.<domain>, reached
  # via GET /reports/:slug/open minting a short-lived edit token and
  # redirecting there (open-report.server.ts, ownerOpenLocation).
  #
  # What THIS scenario still proves: the authenticated, canWrite-gated half of
  # that hand-off on the APP side — a signed-in owner is not bounced to
  # /sign-in, and /open's redirect Location is edit-shaped (points at
  # "<slug>/edit" and carries a minted "et=" edit-token query param). It
  # intentionally does NOT navigate a real browser to the redirect target and
  # assert rendering/hydration, for two reasons: (1) VIEW_ORIGIN is only
  # configured for the "production" Vercel env target
  # (infra/terraform/envs/prod/main.tf) — NOT for preview deployments, which is
  # what this smoke runs against — so on a preview the redirect Location is
  # a same-origin URL Remix has no route for; (2) even with VIEW_ORIGIN wired
  # up, driving the view app's OWN SSR/hydration would need a cross-origin
  # Playwright harness this repo's single-project playwright.config.ts doesn't
  # have yet.
  #
  # TODO(#173 follow-up): restore real-browser SSR/hydration coverage for the
  # unified editor (the actual #171/#172 regression class today) as a smoke
  # feature that targets apps/view directly, once previews get their own
  # VIEW_ORIGIN and the harness supports a second, view-app baseURL. Until
  # then, apps/view has unit-level coverage for the edit-session pieces
  # (apps/view/app/edit/**/*.test.ts, apps/view/app/server/edit-session.test.ts)
  # but no real-browser render/hydration smoke.
  #
  # This scenario runs under the `chromium-auth` Playwright project, whose `page`
  # fixture is pre-authenticated via storageState (tests/e2e/support/clerk-auth.setup.ts) —
  # a real Clerk browser session for the SAME seeded test user auth-upload.feature
  # uses, established via a Clerk sign-in ticket (@clerk/testing), not a Bearer header.
  # `page.request` (not `page.goto`) is used to read the redirect Location without
  # actually navigating anywhere — it shares the authenticated page's cookies.
  #
  # Gated like @auth, plus one more requirement: @browser additionally needs
  # E2E_CLERK_PUBLISHABLE_KEY (the sign-in ticket exchange happens client-side,
  # via @clerk/clerk-js, which needs the publishable key to initialize). Absent
  # any of the three, playwright.config.ts grep-excludes @browser entirely — it
  # never runs half-configured (see the `chromium` project's grepInvert there).
  Background:
    Given a report I own exists

  Scenario: Opening the report authenticates its owner and hands off toward the unified editor
    When I open that report
    Then I am not redirected to sign-in
    And I am redirected to an edit-shaped location for that report
