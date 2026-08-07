@phase-1 @security @smoke
Feature: Block service-worker registration
  As the platform operator
  I want service-worker scripts refused at the edge, on both origins
  So that hosted content cannot persist a background interceptor past takedown (ADR-0014)

  # WIRED 2026-08-06 (it was a step-less @wip skeleton for months). This feature
  # was the clearest hole in the corpus: `apps/view/middleware.ts` and
  # `apps/app/middleware.ts` each implement the refusal in four lines, both are
  # correct, and NOTHING anywhere in the repo tested either of them — no unit
  # test, no browser test, no smoke scenario. A security control with zero
  # coverage and a `.feature` file implying otherwise is worse than no file at
  # all, because the file is what stops the next person writing the test.
  #
  # WHY THIS IS AN E2E AND NOT A UNIT TEST. The middleware body is not the
  # interesting part; the fact that it is REACHED is. Vercel Edge Middleware runs
  # on the platform, ahead of the Remix server, selected by a `matcher` export
  # and a build-time file convention. A unit test calling `middleware(req)`
  # directly would pass on a deployment where the matcher was mis-scoped, the
  # file renamed, or the middleware simply not bundled — which is precisely the
  # failure mode this control needs protecting from. Only a request to a real
  # deployment can say the edge ran.
  #
  # THE ASSERTION IS OUR OWN 403, NOT ANY 403. Vercel Deployment Protection
  # answers 401/403 for its own reasons on a preview, so a bare status check
  # could pass on a deployment where the middleware never executed. Both the
  # refusal body and the `x-edge-marker` the middleware sets on its own Response
  # are asserted; that pair can only come from our code running at the edge.
  # (Same reasoning as app-route-boot.feature's problem+json assertion.)
  #
  # Browsers send `Service-Worker: script` on the script fetch they intend to
  # register, so refusing that request is what stops the registration completing.

  Scenario: The viewer origin refuses a service-worker script fetch
    When the view origin is asked for "/sw.js" with a service-worker script header
    Then the edge itself refuses it with marker "view-mw-sw-blocked"

  Scenario: The dashboard origin refuses one too, as defense in depth
    When the app origin is asked for "/sw.js" with a service-worker script header
    Then the edge itself refuses it with marker "app-mw-sw-blocked"

  # The negative half, and it is load-bearing: a middleware that refused
  # EVERYTHING would satisfy both scenarios above while breaking the product.
  Scenario: An ordinary request without the header is unaffected
    When the app origin is asked for "/health" with no service-worker header
    Then it is served normally, not refused as a service worker
