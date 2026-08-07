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
  # What THIS scenario proves, in two halves:
  #
  # (1) The authenticated, canWrite-gated half of the hand-off on the APP
  # side — a signed-in owner is not bounced to /sign-in, and /open's redirect
  # Location is edit-shaped (points at "<slug>/edit" and carries a minted
  # "et=" edit-token query param).
  #
  # (2) RETRIMMED AGAIN (deployed-preview cross-origin editor render, closing
  # the gap that let the owner-lockout regression ship): the VIEW side of the
  # SAME hand-off now actually gets driven too. On a preview, VIEW_ORIGIN is
  # unset (Terraform wires it prod-only) so /open's redirect Location — built
  # from the app's OWN request-origin fallback (container.server.ts) — points
  # at a same-origin app URL with no route (the circular-URL problem). Rather
  # than wire VIEW_ORIGIN for previews (which would need the view's URL
  # BEFORE the app deploys — circular the other way), this scenario extracts
  # the `et=` token from that (broken) Location and navigates a real browser
  # directly to the deployed VIEW preview's own URL instead — captured once
  # by preview-isolation.yml's `redeploy` job and threaded here as
  # PLAYWRIGHT_VIEW_BASE_URL. VIEW_ACCESS_TOKEN_SECRET is already the same
  # value on both projects on previews, so the token verifies and the unified
  # editor renders for real; if the deployed secrets ever drift apart, the
  # view degrades to the public viewer/`/unlock` and THIS scenario fails —
  # exactly the class of regression that shipped uncaught (PR #185/#187).
  #
  # (3) THE SECOND HOP (ADR-0080). This scenario used to stop at the 303. Every
  # step of BOTH production incidents — #188's re-nested /edit route and the
  # ADR-0080 owner lockout — happened on the request AFTER it: the one carrying
  # the `arp_edit` cookie. It stopped there because reaching that hop needs a
  # SERVABLE report, i.e. a clean scan, and Cloudflare's scan-cron Worker only
  # targets prod — so a preview's upload stays `pending` forever and `/edit` can
  # only ever redirect. That follow-up was tracked across both incidents without
  # advancing. It is wired now: e2e.yml and preview-isolation.yml derive the
  # same per-PR SCAN_DRAIN_SECRET, the scenario drives POST /internal/scan-drain
  # itself, and then asserts 200 — not 302 — on the cookie-carrying request.
  #
  # (4) THE NEGATIVE (ADR-0080). A report the editor cannot open — a document
  # whose <body> never closes, the shape that survives ADR-0062 Amendment 4 —
  # must be
  # ACCEPTED, must view, must read back as `editability: "unsplittable"` on the
  # API, and must DEGRADE off `/edit` rather than 500 or vanish. "Views fine,
  # won't edit" is a legitimate state; this proves it is a legible one.
  #
  # STILL NOT COVERED (out of scope here): the mismatched-secret DEGRADE path
  # itself (fix/owner-open-degrade's `oa=` fallback) has local-boot/unit
  # coverage only (apps/view/app/server/edit-session.test.ts) — this scenario
  # exercises the HAPPY path of the deployed round-trip, not the degrade one.
  #
  # This scenario runs under the `chromium-auth` Playwright project, whose `page`
  # fixture is pre-authenticated via storageState (tests/e2e/support/clerk-auth.setup.ts) —
  # a real Clerk browser session for the SAME seeded test user auth-upload.feature
  # uses, established via a Clerk sign-in ticket (@clerk/testing), not a Bearer header.
  # `page.request` (not `page.goto`) is used to read the /open redirect Location
  # without actually navigating anywhere — it shares the authenticated page's
  # cookies. The view-render half below DOES navigate (`page.goto`), to the
  # view preview's own origin — a genuine cross-origin browser hop.
  #
  # Gated like @auth, plus one more requirement: @browser additionally needs
  # E2E_CLERK_PUBLISHABLE_KEY (the sign-in ticket exchange happens client-side,
  # via @clerk/clerk-js, which needs the publishable key to initialize). Absent
  # any of the three, playwright.config.ts grep-excludes @browser entirely — it
  # never runs half-configured (see the `chromium` project's grepInvert there).
  Scenario: Opening the report authenticates its owner and hands off toward the unified editor
    Given a report I own exists
    And that report has been scanned clean
    When I open that report
    Then I am not redirected to sign-in
    And I am redirected to an edit-shaped location for that report
    And the view edit route accepts the edit token instead of falling back to the public viewer
    And the cookie-carrying request opens the editor instead of redirecting

  Scenario: A report the editor cannot open is accepted, legible, and degrades cleanly
    Given a report I own that the editor cannot open exists
    And that report has been scanned clean
    Then the report reads back as un-editable over the API
    When I open that report
    Then I am redirected to an edit-shaped location for that report
    And the view edit route accepts the edit token instead of falling back to the public viewer
    And the view edit route degrades to a read-only view instead of failing
