@smoke @auth @browser
Feature: Navigate and find Reports on a phone (real browser)
  As a signed-in user on a phone
  I want to open and dismiss navigation and find my Report in a list that fits
  So that the deployed dashboard is usable at phone width, not only in a harness

  # WHAT THIS PROVES THAT THE BROWSER TIER CANNOT (#403). The hermetic tier
  # (tests/browser/app-shell-mobile.spec.ts, report-list-mobile.spec.ts —
  # ADR-0079's app-component amendment) mounts the production AppShell and
  # DashboardPage with the app's compiled stylesheet, but with FIXTURE data,
  # a stub account control and a memory router. Here the same journey runs on
  # the deployed preview as the primary fixture user: real Clerk session and
  # <UserButton>, real loaders, the real stylesheet the app serves, and a real
  # `?q=` round-trip through the dashboard loader.
  #
  # Desktop Chromium resized to 390×844 with mouse input — a phone-WIDTH
  # layout, not a phone. Touch emulation lives in the browser tier; the
  # software keyboard, iOS Safari and real touch selection are covered by no
  # automated tier (a recorded limitation, see #403's PR).
  #
  # The Report is uploaded over the API (unique bytes, found by its slug — the
  # API path sets no title) and deleted by the step file's After hook. On a
  # preview nothing drains the scan queue unless a scenario does, so the
  # Report may be Processing or Published when its row is read; both are
  # legitimate and each is asserted for what it must show.
  Scenario: A phone user opens and dismisses navigation, finds a Report and chooses a destination
    Given a Report of mine exists for the phone journey
    And my browser is a 390px-wide phone
    When I open the dashboard on the phone
    Then the phone navigation is closed and the Report list takes the width
    When I open the phone navigation
    Then the phone navigation offers Reports, Folders, API keys and my account
    When I dismiss the phone navigation with Escape
    Then focus is back on the phone navigation's trigger
    When I filter the phone Report list for that Report
    Then that Report's row shows its status and its actions without sideways scrolling
    When I choose API keys from the phone navigation
    Then the phone navigation has closed on the API keys page
