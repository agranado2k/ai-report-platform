@smoke @auth @browser
Feature: Owner-view deck smoke — a private script-driven report actually runs (real browser)
  As a signed-in report owner
  I want opening my own script-driven deck to land me on a deck that RUNS
  So that the owner view's whole reason for existing is verified on a real
  deployment rather than argued for in an ADR

  # WHAT THIS PROVES, AND WHY NOTHING ELSE ALREADY DOES IT (#366, ADR-0089).
  #
  # ADR-0089 exists because of one observed regression: the owner was the single
  # principal who could NOT see their own report as published. Routed into the
  # ProseMirror editor (ADR-0063 Phase 5), a slide deck arrived as a flat wall of
  # text — the editor's schema drops <script>, flattens <svg> and strips class
  # from <section> (ADR-0062 §3). The owner view is the repair: first-party
  # chrome ABOVE the byte-for-byte `/<slug>`, in a sandboxed iframe.
  #
  # Three tiers already cover parts of that, and each stops short of the claim:
  #
  #   - `apps/view/app/view/frame.test.ts` pins the sandbox/allow token sets
  #     against ADR-0089 §2 — but it is a pure unit test over two constants, and
  #     a constant is not an attribute on a shipped page.
  #   - `tests/browser/owner-view-framing.spec.ts` (ADR-0079 §7) frames a report
  #     over a hermetic loopback server and proves the containment: the opaque
  #     origin, `frame-ancestors 'self'`, the `Path=/<slug>` unlock cookie. But
  #     its server is a fixture. It never asks whether the DEPLOYED view app
  #     renders that frame, or whether the DEPLOYED report response carries the
  #     ADR-0088 allowlist.
  #   - `editor-auth.feature` drives the deployed hand-off — but toward `/edit`,
  #     and it asserts markers (`data-testid="unified-editor"`) in HTML TEXT. It
  #     never runs the report.
  #
  # So the gap is precisely the payoff: on a real deployment, does the framed
  # report EXECUTE, and does the CSP let its resources load? Everything below
  # needs a real browser to answer — an HTML-text assertion cannot tell a deck
  # that advances from one that does not.
  #
  # THE FIXTURE. `tests/e2e/fixtures/owner-view-deck.html` — a test asset, not a
  # schema fixture (its own header argues that). Two slides toggled by `hidden`
  # with its OWN `[hidden]{display:none!important}` reset (the canonical
  # `/<slug>` serves the author's bytes and nothing else, ADR-0038, so a deck
  # relying on the artifact host's reset paints both slides — that defect is
  # #362's fidelity verdict, not something the viewer patches), an inline script
  # advancing on ArrowRight, and a Google Fonts <link>.
  #
  # THE REPORT IS PRIVATE, which is the default since ADR-0075 and is the
  # interesting case rather than an incidental one. A private report's framed
  # `GET /<slug>` is gated on its own merits, so the frame renders ONLY because
  # ADR-0089 §4c's hand-off put an `arp_unlock` cookie at `Path=/<slug>`. A deck
  # that advances here is therefore also the end-to-end proof of that cookie: if
  # the 303 stopped setting it, the frame would show the unlock wall and slide
  # two would never appear.
  #
  # WHY THE DASHBOARD CLICK IS ASSERTED BUT NOT FOLLOWED. The acceptance
  # criterion is "click Open on the report row". On a PREVIEW that click cannot
  # be followed, for the reason `editor-auth.feature` documents at length:
  # VIEW_ORIGIN is wired by Terraform on PROD ONLY, so `/reports/{slug}/open`
  # builds its Location from the app's OWN request origin
  # (container.server.ts) and points at an app-origin URL with no route behind
  # it — the circular-URL problem, unfixable from here because the view's URL is
  # not known until after the app deploys. So this scenario does both halves
  # honestly: it loads the real dashboard as the signed-in owner and asserts the
  # row's real Open affordance (the stretched link in ReportRow.tsx, reached by
  # its accessible name) points at the ONE mint, then lifts the minted `et=`/`oa=`
  # out of that mint's Location and navigates a real browser to the deployed
  # VIEW preview — PLAYWRIGHT_VIEW_BASE_URL, captured by preview-isolation.yml's
  # `redeploy` job. That is the same seam `editor-auth.feature` crosses, used
  # for the same reason.
  #
  # THE GOOGLE FONTS ASSERTION IS A DISCRIMINATION, NOT A PING. A CSP-refused
  # subresource never becomes a network request at all, so it produces NO
  # Playwright request event; an unreachable host produces a `requestfailed`
  # with a network failure string. The step distinguishes those two outcomes and
  # names which one it saw, so "CI has no egress to fonts.gstatic.com" can never
  # be mistaken for "ADR-0088's allowlist regressed", which is the only reason
  # the assertion is worth having.
  #
  # GATING. `@browser` needs E2E_CLERK_SECRET_KEY + E2E_TEST_USER_EMAIL +
  # E2E_CLERK_PUBLISHABLE_KEY, or playwright.config.ts grep-excludes it entirely.
  # Beyond that this scenario needs PLAYWRIGHT_VIEW_BASE_URL (a deployed view
  # origin to navigate to) and E2E_SCAN_DRAIN_SECRET (nothing promotes a
  # preview's upload past `scan_status: pending`, and an unservable report cannot
  # be framed). Both are produced by preview-isolation.yml and threaded through
  # e2e.yml; absent them the scenario skips cleanly on a local `pnpm e2e`, and in
  # CI the `no-silent-skip` reporter turns that skip into a FAILURE, because
  # there a skip means the wiring broke rather than that the dev box is offline.
  Scenario: A private script-driven deck opened from the dashboard runs inside the owner view
    Given a private script-driven deck I own is published
    When I open that deck from the dashboard
    Then the owner view chrome is present
    And the framed report carries the owner-view iframe contract
    When I press the right arrow key
    Then the deck advances to slide two inside the frame
    And the deck's Google Fonts stylesheet was fetched rather than refused by the CSP
