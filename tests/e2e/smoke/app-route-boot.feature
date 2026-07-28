@smoke
Feature: App-origin route boot check (report-html import)
  As the platform operator
  I want an app-origin route that imports arp-report-html to answer without a 5xx
  So that a serverless module-load crash in that dependency can never sail through CI again

  # Regression guard for the #163/#167 PROD-DOWN incident (follow-up issue #166), same class
  # as the earlier argon2 incident (#100 -> #103, see health.feature). PR #151 put
  # arp-report-html into apps/app's server bundle; jsdom's transitive deps (css-tree's
  # data/patch.json, then html-encoding-sniffer's ESM-only @exodus/bytes) could not be
  # traced/bundled for Vercel's serverless runtime, so the WHOLE app server crashed at cold
  # boot and EVERY app route 500'd. That sailed through CI green because the existing smoke
  # only hit /health, /api/v1/reports, /, /upload and /sign-in — none of which import
  # report-html, so none of them could have caught it.
  #
  # RETARGETED (ADR-0063 Phase 5 dashboard-editor retirement): this used to hit
  # reports.$slug.edit.tsx (the dashboard editor page, now deleted — the unified
  # in-viewer experience on view.<domain> is the sole editing surface). The
  # SAME import-at-module-scope risk now lives in api.v1.reports.$slug.diff.ts,
  # which pulls in report-diff-loader.server.ts -> arp-report-html's `splitShell`
  # at module scope (used to build the structural diff), so it's an equally
  # good (and now the correct, still-live) boot-crash canary.
  #
  # The assertion is deliberately auth-agnostic: `handle()` resolves the actor
  # BEFORE touching the slug, query params, or any report-html code, so an
  # unauthenticated GET answers 401 (JSON) — it never needs a Clerk session or
  # a real report. But Remix/Vercel loads a route's WHOLE module graph to serve
  # ANY response on it (loader + its imports in one server bundle), so a 401
  # here still proves the arp-report-html import resolved and the server
  # booted. Only a genuine 5xx — the exact failure mode of #163/#167 — would
  # mean the module graph is broken again. This scenario does NOT assert
  # authorization correctness of the route; it only proves the server didn't
  # crash trying to load it.
  Scenario: A route that imports report-html answers without a boot crash
    When I GET the report-html-importing app route "/api/v1/reports/does-not-exist/diff"
    Then the app did not crash booting that route
